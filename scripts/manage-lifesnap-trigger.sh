#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

mode="${1:-}"
case "${mode}" in
  prepare-disable | verify-disabled | run-exact | restore) ;;
  *)
    printf 'usage: %s {prepare-disable|verify-disabled|run-exact|restore}\n' \
      "$0" >&2
    exit 64
    ;;
esac

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${TRIGGER_REGION:?TRIGGER_REGION is required}"
: "${TRIGGER_ID:?TRIGGER_ID is required}"

python3 - "${PROJECT_ID}" "${TRIGGER_REGION}" "${TRIGGER_ID}" <<'PY'
import re
import sys

project_id, region, trigger_id = sys.argv[1:]
patterns = (
    (project_id, r"[a-z][a-z0-9:.-]{4,62}", "PROJECT_ID"),
    (region, r"[a-z][a-z0-9-]{0,62}", "TRIGGER_REGION"),
    (trigger_id, r"[A-Za-z0-9_-]{1,128}", "TRIGGER_ID"),
)
for value, pattern, label in patterns:
    if not re.fullmatch(pattern, value):
        raise SystemExit(f"{label} is invalid")
PY

script_directory="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P
)"
repository_root="$(git -C "${script_directory}" rev-parse --show-toplevel)"
repository_root="$(python3 - "${repository_root}" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
git_directory="$(git -C "${repository_root}" rev-parse --path-format=absolute --git-dir)"
git_directory="$(python3 - "${git_directory}" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"

if [[ -n "${TRIGGER_MANIFEST_FILE:-}" ]]; then
  if [[ "${TRIGGER_MANIFEST_FILE}" != /* ]]; then
    printf 'TRIGGER_MANIFEST_FILE must be absolute\n' >&2
    exit 64
  fi
  manifest_file="${TRIGGER_MANIFEST_FILE}"
  state_directory="$(dirname -- "${manifest_file}")"
else
  state_base="$(python3 - "${TMPDIR:-/tmp}" <<'PY'
import os
import sys
path = os.path.realpath(sys.argv[1])
if not os.path.isdir(path):
    raise SystemExit("TMPDIR does not resolve to a directory")
print(path)
PY
)"
  worktree_key="$(python3 - "${repository_root}" "${git_directory}" <<'PY'
import hashlib
import sys
print(hashlib.sha256("\0".join(sys.argv[1:]).encode()).hexdigest()[:24])
PY
)"
  state_directory="${state_base}/lifesnap-trigger-state-$(id -u)-${worktree_key}"
  manifest_file="${state_directory}/manifest.json"
  if [[ ! -e "${state_directory}" && ! -L "${state_directory}" ]]; then
    mkdir -m 700 -- "${state_directory}"
  fi
fi

python3 - "${state_directory}" "${manifest_file}" <<'PY'
import os
import stat
import sys

directory, manifest = sys.argv[1:]
if os.path.realpath(directory) != directory:
    raise SystemExit("Trigger state directory must be canonical")
details = os.lstat(directory)
if not stat.S_ISDIR(details.st_mode):
    raise SystemExit("Trigger state parent must be a directory")
if details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) != 0o700:
    raise SystemExit("Trigger state parent must be user-owned mode 0700")
if os.path.dirname(manifest) != directory:
    raise SystemExit("Trigger manifest path must be a direct child of its state directory")
if os.path.realpath(manifest) != manifest and not os.path.lexists(manifest):
    raise SystemExit("Trigger manifest path must be canonical")
PY

printf 'trigger_manifest=%s\n' "${manifest_file}"

scratch_directory="$(mktemp -d "${state_directory}/.work.XXXXXXXX")"
manifest_copy="${scratch_directory}/manifest.json"
current_trigger="${scratch_directory}/current.json"
patch_payload="${scratch_directory}/patch.json"
patch_response="${scratch_directory}/patch-response.json"
fresh_trigger="${scratch_directory}/fresh.json"
build_response="${scratch_directory}/build.json"

cleanup() {
  rm -f -- \
    "${manifest_copy}" \
    "${current_trigger}" \
    "${patch_payload}" \
    "${patch_response}" \
    "${fresh_trigger}" \
    "${build_response}"
  rmdir -- "${scratch_directory}" 2>/dev/null || true
}
trap cleanup EXIT

manifest_identity=""
manifest_preexisting="false"
trigger_api="https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/${TRIGGER_REGION}/triggers/${TRIGGER_ID}"
access_token=""

validate_trigger_snapshot() {
  local snapshot_path="$1"
  python3 - \
    "${snapshot_path}" \
    "${PROJECT_ID}" \
    "${TRIGGER_REGION}" \
    "${TRIGGER_ID}" <<'PY'
import json
import sys
from pathlib import Path

path, project_id, region, trigger_id = sys.argv[1:]
try:
    trigger = json.loads(Path(path).read_text())
except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
    raise SystemExit(f"Trigger snapshot is invalid: {error}")
if not isinstance(trigger, dict):
    raise SystemExit("Trigger snapshot must be an object")
if "disabled" in trigger and not isinstance(trigger["disabled"], bool):
    raise SystemExit("Trigger disabled state must be boolean or omitted")
expected_name = f"projects/{project_id}/locations/{region}/triggers/{trigger_id}"
if trigger.get("id") != trigger_id or trigger.get("resourceName") != expected_name:
    raise SystemExit("Trigger snapshot identity does not match requested configuration")
PY
}

store_manifest() {
  local snapshot_path="$1"
  python3 - \
    "${snapshot_path}" \
    "${manifest_file}" \
    "${PROJECT_ID}" \
    "${TRIGGER_REGION}" \
    "${TRIGGER_ID}" <<'PY'
import json
import os
import secrets
import sys
from pathlib import Path

snapshot_path, target, project_id, region, trigger_id = sys.argv[1:]
snapshot = json.loads(Path(snapshot_path).read_text())
manifest = {
    "schema_version": 1,
    "project_id": project_id,
    "trigger_region": region,
    "trigger_id": trigger_id,
    "prior_disabled": snapshot.get("disabled", False),
    "trigger_snapshot": snapshot,
}
contents = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
directory = os.path.dirname(target)
temporary = os.path.join(directory, f".manifest-{os.getpid()}-{secrets.token_hex(8)}")
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    with os.fdopen(descriptor, "wb") as output:
        output.write(contents)
        output.flush()
        os.fsync(output.fileno())
    try:
        os.link(temporary, target, follow_symlinks=False)
    except FileExistsError:
        raise SystemExit("A trigger manifest already exists; refusing to overwrite it")
    os.unlink(temporary)
    directory_descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
finally:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
PY
}

load_manifest() {
  manifest_identity="$(python3 - \
    "${manifest_file}" \
    "${manifest_copy}" \
    "${PROJECT_ID}" \
    "${TRIGGER_REGION}" \
    "${TRIGGER_ID}" <<'PY'
import hashlib
import json
import os
import stat
import sys

source, destination, project_id, region, trigger_id = sys.argv[1:]
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
try:
    descriptor = os.open(source, flags)
except OSError as error:
    raise SystemExit(f"Trigger manifest cannot be opened safely: {error}")
try:
    details = os.fstat(descriptor)
    if not stat.S_ISREG(details.st_mode):
        raise SystemExit("Trigger manifest must be a regular file")
    if details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) != 0o600:
        raise SystemExit("Trigger manifest must be user-owned mode 0600")
    if details.st_nlink != 1:
        raise SystemExit("Trigger manifest must have exactly one hard link")
    if details.st_size > 1024 * 1024:
        raise SystemExit("Trigger manifest is unexpectedly large")
    chunks = []
    while True:
        chunk = os.read(descriptor, 65536)
        if not chunk:
            break
        chunks.append(chunk)
    raw = b"".join(chunks)
finally:
    os.close(descriptor)
try:
    manifest = json.loads(raw)
except (UnicodeDecodeError, json.JSONDecodeError) as error:
    raise SystemExit(f"Trigger manifest is corrupt: {error}")
expected_keys = {
    "schema_version",
    "project_id",
    "trigger_region",
    "trigger_id",
    "prior_disabled",
    "trigger_snapshot",
}
if not isinstance(manifest, dict) or set(manifest) != expected_keys:
    raise SystemExit("Trigger manifest schema is invalid")
if manifest["schema_version"] != 1:
    raise SystemExit("Trigger manifest schema version is unsupported")
if (
    manifest["project_id"] != project_id
    or manifest["trigger_region"] != region
    or manifest["trigger_id"] != trigger_id
):
    raise SystemExit("Trigger manifest configuration does not match this invocation")
snapshot = manifest["trigger_snapshot"]
if not isinstance(snapshot, dict):
    raise SystemExit("Trigger manifest snapshot is invalid")
if "disabled" in snapshot and not isinstance(snapshot["disabled"], bool):
    raise SystemExit("Trigger manifest disabled state is invalid")
if not isinstance(manifest["prior_disabled"], bool):
    raise SystemExit("Trigger manifest prior disabled state is invalid")
if manifest["prior_disabled"] != snapshot.get("disabled", False):
    raise SystemExit("Trigger manifest prior disabled state is inconsistent")
expected_name = f"projects/{project_id}/locations/{region}/triggers/{trigger_id}"
if snapshot.get("id") != trigger_id or snapshot.get("resourceName") != expected_name:
    raise SystemExit("Trigger manifest snapshot identity is invalid")
with open(destination, "wb") as output:
    output.write(raw)
print(f"{details.st_dev}:{details.st_ino}:{hashlib.sha256(raw).hexdigest()}")
PY
)"
}

get_trigger() {
  local destination="$1"
  curl --fail --silent --show-error \
    --header "Authorization: Bearer ${access_token}" \
    --output "${destination}" \
    "${trigger_api}"
  validate_trigger_snapshot "${destination}"
}

compare_current() {
  local current_path="$1"
  local comparison="$2"
  python3 - "${current_path}" "${manifest_copy}" "${comparison}" <<'PY'
import json
import sys
from pathlib import Path

current_path, manifest_path, comparison = sys.argv[1:]
current = json.loads(Path(current_path).read_text())
snapshot = json.loads(Path(manifest_path).read_text())["trigger_snapshot"]

if comparison == "exact":
    matches = current == snapshot
elif comparison == "disabled":
    current_without = dict(current)
    snapshot_without = dict(snapshot)
    current_disabled = current_without.pop("disabled", False)
    snapshot_without.pop("disabled", None)
    matches = current_disabled is True and current_without == snapshot_without
elif comparison == "original-or-disabled":
    if current == snapshot:
        print("original")
        raise SystemExit(0)
    current_without = dict(current)
    snapshot_without = dict(snapshot)
    current_disabled = current_without.pop("disabled", False)
    snapshot_without.pop("disabled", None)
    if current_disabled is True and current_without == snapshot_without:
        print("disabled")
        raise SystemExit(0)
    raise SystemExit("Current trigger has drifted from the saved snapshot")
else:
    raise SystemExit("Unknown trigger comparison")
if not matches:
    raise SystemExit("Current trigger does not match the saved snapshot")
PY
}

write_patch_payload() {
  local disabled="$1"
  python3 - "${manifest_copy}" "${patch_payload}" "${disabled}" <<'PY'
import json
import sys
from pathlib import Path

manifest_path, destination, disabled = sys.argv[1:]
trigger = json.loads(Path(manifest_path).read_text())["trigger_snapshot"]
trigger["disabled"] = disabled == "true"
Path(destination).write_text(json.dumps(trigger, separators=(",", ":")) + "\n")
PY
}

patch_disabled() {
  local disabled="$1"
  write_patch_payload "${disabled}"
  curl --fail --silent --show-error \
    --request PATCH \
    --header "Authorization: Bearer ${access_token}" \
    --header "Content-Type: application/json" \
    --data-binary "@${patch_payload}" \
    --output "${patch_response}" \
    "${trigger_api}?updateMask=disabled"
}

delete_manifest() {
  python3 - "${manifest_file}" "${manifest_identity}" <<'PY'
import hashlib
import os
import stat
import sys

path, expected_identity = sys.argv[1:]
expected_device, expected_inode, expected_digest = expected_identity.split(":", 2)
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
descriptor = os.open(path, flags)
try:
    details = os.fstat(descriptor)
    if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
        raise SystemExit("Trigger manifest identity changed before deletion")
    chunks = []
    while True:
        chunk = os.read(descriptor, 65536)
        if not chunk:
            break
        chunks.append(chunk)
    actual = f"{details.st_dev}:{details.st_ino}:{hashlib.sha256(b''.join(chunks)).hexdigest()}"
    if actual != expected_identity:
        raise SystemExit("Trigger manifest identity changed before deletion")
finally:
    os.close(descriptor)
directory = os.path.dirname(path)
directory_descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
try:
    current = os.stat(os.path.basename(path), dir_fd=directory_descriptor, follow_symlinks=False)
    if current.st_dev != int(expected_device) or current.st_ino != int(expected_inode):
        raise SystemExit("Trigger manifest identity changed before deletion")
    os.unlink(os.path.basename(path), dir_fd=directory_descriptor)
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PY
}

ensure_manifest_loaded() {
  if [[ ! -e "${manifest_file}" && ! -L "${manifest_file}" ]]; then
    printf 'No prepared trigger manifest exists\n' >&2
    return 1
  fi
  load_manifest
}

prepare_disable() {
  if [[ -e "${manifest_file}" || -L "${manifest_file}" ]]; then
    manifest_preexisting="true"
    load_manifest
  else
    access_token="$(gcloud auth print-access-token)"
    get_trigger "${current_trigger}"
    store_manifest "${current_trigger}"
    load_manifest
  fi
  if [[ -z "${access_token}" ]]; then
    access_token="$(gcloud auth print-access-token)"
  fi
  get_trigger "${current_trigger}"
  local current_classification
  current_classification="$(compare_current "${current_trigger}" original-or-disabled)"
  if [[ "${current_classification}" == "original" ]]; then
    local prior_disabled
    prior_disabled="$(python3 - "${manifest_copy}" <<'PY'
import json
import sys
from pathlib import Path
print(str(json.loads(Path(sys.argv[1]).read_text())["prior_disabled"]).lower())
PY
)"
    if [[ "${prior_disabled}" != "true" ]]; then
      patch_disabled true
      compare_current "${patch_response}" disabled
      get_trigger "${fresh_trigger}"
      compare_current "${fresh_trigger}" disabled
    fi
  fi
  printf 'trigger_lifecycle=PREPARED already_prepared=%s\n' "${manifest_preexisting}"
}

verify_disabled() {
  ensure_manifest_loaded
  access_token="$(gcloud auth print-access-token)"
  get_trigger "${current_trigger}"
  compare_current "${current_trigger}" disabled
  printf 'trigger_lifecycle=DISABLED\n'
}

run_exact() {
  : "${MERGED_SHA:?MERGED_SHA is required for run-exact}"
  if [[ ! "${MERGED_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
    printf 'MERGED_SHA must be exactly 40 hexadecimal characters\n' >&2
    return 64
  fi
  local normalized_sha
  normalized_sha="$(printf '%s' "${MERGED_SHA}" | tr '[:upper:]' '[:lower:]')"
  ensure_manifest_loaded
  access_token="$(gcloud auth print-access-token)"
  get_trigger "${current_trigger}"
  compare_current "${current_trigger}" disabled
  gcloud builds triggers run "${TRIGGER_ID}" \
    --project="${PROJECT_ID}" \
    --region="${TRIGGER_REGION}" \
    --sha="${normalized_sha}" \
    --format=json > "${build_response}"
  local build_identity
  build_identity="$(python3 - "${build_response}" "${normalized_sha}" <<'PY'
import json
import sys
from pathlib import Path

path, expected_commit = sys.argv[1:]
try:
    build = json.loads(Path(path).read_text())
except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
    raise SystemExit(f"Trigger run response is invalid: {error}")
build_id = build.get("id")
commit = build.get("substitutions", {}).get("COMMIT_SHA")
if not isinstance(build_id, str) or not build_id:
    raise SystemExit("Trigger run did not report a build id")
if not isinstance(commit, str) or commit.lower() != expected_commit:
    raise SystemExit("Trigger run did not report the exact requested commit")
print(build_id, commit.lower())
PY
)"
  local build_id built_commit
  read -r build_id built_commit <<< "${build_identity}"
  printf 'trigger_lifecycle=RUN build_id=%s commit=%s\n' \
    "${build_id}" "${built_commit}"
}

restore_trigger() {
  ensure_manifest_loaded
  access_token="$(gcloud auth print-access-token)"
  get_trigger "${current_trigger}"
  local current_classification
  current_classification="$(compare_current "${current_trigger}" original-or-disabled)"
  if [[ "${current_classification}" != "original" ]]; then
    local prior_disabled
    prior_disabled="$(python3 - "${manifest_copy}" <<'PY'
import json
import sys
from pathlib import Path
print(str(json.loads(Path(sys.argv[1]).read_text())["prior_disabled"]).lower())
PY
)"
    patch_disabled "${prior_disabled}"
    get_trigger "${fresh_trigger}"
    compare_current "${fresh_trigger}" exact
  fi
  delete_manifest
  printf 'trigger_lifecycle=RESTORED\n'
}

case "${mode}" in
  prepare-disable) prepare_disable ;;
  verify-disabled) verify_disabled ;;
  run-exact) run_exact ;;
  restore) restore_trigger ;;
  *)
    printf 'Unknown trigger lifecycle mode: %s\n' "${mode}" >&2
    exit 64
    ;;
esac
