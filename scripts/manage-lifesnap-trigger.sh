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
  state_directory="${git_directory}/lifesnap-trigger-state"
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
run_request="${scratch_directory}/run-request.json"
recovery_builds="${scratch_directory}/recovery-builds.json"

cleanup() {
  rm -f -- \
    "${manifest_copy}" \
    "${current_trigger}" \
    "${patch_payload}" \
    "${patch_response}" \
    "${fresh_trigger}" \
    "${build_response}" \
    "${run_request}" \
    "${recovery_builds}"
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
    "schema_version": 2,
    "project_id": project_id,
    "trigger_region": region,
    "trigger_id": trigger_id,
    "prior_disabled": snapshot.get("disabled", False),
    "run_state": None,
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
    "run_state",
    "trigger_snapshot",
}
if not isinstance(manifest, dict) or set(manifest) != expected_keys:
    raise SystemExit("Trigger manifest schema is invalid")
if manifest["schema_version"] != 2:
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
run_state = manifest["run_state"]
if run_state is not None:
    if not isinstance(run_state, dict) or run_state.get("status") not in {"intent", "accepted"}:
        raise SystemExit("Trigger manifest run state is invalid")
    sha = run_state.get("sha")
    if not isinstance(sha, str) or len(sha) != 40 or any(character not in "0123456789abcdef" for character in sha):
        raise SystemExit("Trigger manifest run SHA is invalid")
    if run_state["status"] == "intent":
        if set(run_state) != {"status", "sha"}:
            raise SystemExit("Trigger manifest run intent is invalid")
    elif (
        set(run_state) != {"status", "sha", "operation_name", "build_id"}
        or not isinstance(run_state.get("build_id"), str)
        or not run_state["build_id"]
        or (
            run_state.get("operation_name") is not None
            and (
                not isinstance(run_state["operation_name"], str)
                or not run_state["operation_name"]
            )
        )
    ):
        raise SystemExit("Trigger manifest accepted run state is invalid")
expected_name = f"projects/{project_id}/locations/{region}/triggers/{trigger_id}"
if snapshot.get("id") != trigger_id or snapshot.get("resourceName") != expected_name:
    raise SystemExit("Trigger manifest snapshot identity is invalid")
with open(destination, "wb") as output:
    output.write(raw)
print(f"{details.st_dev}:{details.st_ino}:{hashlib.sha256(raw).hexdigest()}")
PY
)"
}

set_run_state() {
  local status="$1"
  local sha="$2"
  local operation_name="${3:-}"
  local build_id="${4:-}"
  python3 - \
    "${manifest_file}" \
    "${manifest_identity}" \
    "${status}" \
    "${sha}" \
    "${operation_name}" \
    "${build_id}" <<'PY'
import hashlib
import json
import os
import secrets
import stat
import sys

path, expected_identity, status, sha, operation_name, build_id = sys.argv[1:]
expected_device, expected_inode, expected_digest = expected_identity.split(":", 2)
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
descriptor = os.open(path, flags)
try:
    details = os.fstat(descriptor)
    raw = b""
    while True:
        chunk = os.read(descriptor, 65536)
        if not chunk:
            break
        raw += chunk
    actual_identity = (
        f"{details.st_dev}:{details.st_ino}:{hashlib.sha256(raw).hexdigest()}"
    )
    if (
        actual_identity != expected_identity
        or not stat.S_ISREG(details.st_mode)
        or stat.S_IMODE(details.st_mode) != 0o600
        or details.st_uid != os.getuid()
        or details.st_nlink != 1
    ):
        raise SystemExit("Trigger manifest identity changed before run-state update")
finally:
    os.close(descriptor)
manifest = json.loads(raw)
if status == "intent":
    run_state = {"status": "intent", "sha": sha}
elif status == "accepted":
    if not build_id:
        raise SystemExit("Accepted trigger run requires a build id")
    run_state = {
        "status": "accepted",
        "sha": sha,
        "operation_name": operation_name or None,
        "build_id": build_id,
    }
else:
    raise SystemExit("Unknown trigger run-state transition")
manifest["run_state"] = run_state
encoded = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
directory = os.path.dirname(path)
temporary = os.path.join(directory, f".manifest-update-{os.getpid()}-{secrets.token_hex(8)}")
temporary_descriptor = os.open(
    temporary,
    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
    0o600,
)
try:
    with os.fdopen(temporary_descriptor, "wb") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())
    current = os.lstat(path)
    if current.st_dev != int(expected_device) or current.st_ino != int(expected_inode):
        raise SystemExit("Trigger manifest identity changed before run-state commit")
    os.replace(temporary, path)
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
  load_manifest
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
  local remote_main_sha
  remote_main_sha="$(git -C "${repository_root}" rev-parse --verify 'origin/main^{commit}')"
  remote_main_sha="$(printf '%s' "${remote_main_sha}" | tr '[:upper:]' '[:lower:]')"
  if [[ ! "${remote_main_sha}" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'origin/main did not resolve to an exact commit\n' >&2
    return 1
  fi
  if [[ "${normalized_sha}" != "${remote_main_sha}" ]]; then
    printf 'MERGED_SHA does not equal the reviewed origin/main commit\n' >&2
    return 1
  fi
  ensure_manifest_loaded
  access_token="$(gcloud auth print-access-token)"
  get_trigger "${current_trigger}"
  compare_current "${current_trigger}" disabled

  local run_status run_sha run_operation run_build
  IFS=$'\t' read -r run_status run_sha run_operation run_build < <(
    python3 - "${manifest_copy}" <<'PY'
import json
import sys
from pathlib import Path

state = json.loads(Path(sys.argv[1]).read_text()).get("run_state")
if state is None:
    print("none\t-\t-\t-")
elif state["status"] == "intent":
    print(f"intent\t{state['sha']}\t-\t-")
else:
    print(
        "\t".join(
            [
                "accepted",
                state["sha"],
                state["operation_name"] or "-",
                state["build_id"],
            ]
        )
    )
PY
  )
  if [[ "${run_status}" != "none" && "${run_sha}" != "${normalized_sha}" ]]; then
    printf 'Trigger manifest is already bound to a different commit\n' >&2
    return 1
  fi
  if [[ "${run_status}" == "accepted" ]]; then
    printf 'trigger_lifecycle=RUN operation_name=%s build_id=%s commit=%s existing_run=true\n' \
      "${run_operation}" "${run_build}" "${normalized_sha}"
    return 0
  fi
  if [[ "${run_status}" == "intent" ]]; then
    gcloud builds list \
      --project="${PROJECT_ID}" \
      --region="${TRIGGER_REGION}" \
      --filter="buildTriggerId=${TRIGGER_ID}" \
      --limit=50 \
      --format=json > "${recovery_builds}"
    local recovered_build
    recovered_build="$(python3 - \
      "${recovery_builds}" \
      "${PROJECT_ID}" \
      "${TRIGGER_ID}" \
      "${normalized_sha}" <<'PY'
import json
import sys
from pathlib import Path

path, project_id, trigger_id, expected_commit = sys.argv[1:]
try:
    builds = json.loads(Path(path).read_text())
except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
    raise SystemExit(f"Trigger recovery build list is invalid: {error}")
if not isinstance(builds, list):
    raise SystemExit("Trigger recovery build list is invalid")
matches = [
    build
    for build in builds
    if isinstance(build, dict)
    and build.get("projectId") == project_id
    and build.get("buildTriggerId") == trigger_id
    and build.get("substitutions", {}).get("COMMIT_SHA", "").lower()
    == expected_commit
    and isinstance(build.get("id"), str)
    and build["id"]
]
if not matches:
    raise SystemExit("Trigger run intent recovery found none; refusing a duplicate run")
if len(matches) != 1:
    raise SystemExit("Trigger run intent recovery is ambiguous; refusing a duplicate run")
print(matches[0]["id"])
PY
)"
    set_run_state accepted "${normalized_sha}" "" "${recovered_build}"
    printf 'trigger_lifecycle=RUN operation_name=- build_id=%s commit=%s recovered_run=true\n' \
      "${recovered_build}" "${normalized_sha}"
    return 0
  fi

  set_run_state intent "${normalized_sha}"
  python3 - \
    "${run_request}" \
    "${PROJECT_ID}" \
    "${TRIGGER_ID}" \
    "${normalized_sha}" <<'PY'
import json
import sys
from pathlib import Path

path, project_id, trigger_id, commit = sys.argv[1:]
request = {
    "projectId": project_id,
    "triggerId": trigger_id,
    "source": {"commitSha": commit},
}
Path(path).write_text(json.dumps(request, separators=(",", ":")) + "\n")
PY
  curl --fail --silent --show-error \
    --request POST \
    --header "Authorization: Bearer ${access_token}" \
    --header "Content-Type: application/json" \
    --data-binary "@${run_request}" \
    --output "${build_response}" \
    "${trigger_api}:run"
  local operation_identity
  operation_identity="$(python3 - \
    "${build_response}" \
    "${PROJECT_ID}" \
    "${TRIGGER_REGION}" \
    "${TRIGGER_ID}" \
    "${normalized_sha}" <<'PY'
import json
import re
import sys
from pathlib import Path

path, project_id, region, trigger_id, expected_commit = sys.argv[1:]
try:
    operation = json.loads(Path(path).read_text())
except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
    raise SystemExit(f"Trigger run Operation is invalid: {error}")
if not isinstance(operation, dict) or "error" in operation:
    raise SystemExit("Trigger run did not return a successful Operation")
operation_name = operation.get("name")
if not isinstance(operation_name, str) or not re.fullmatch(
    r"(?:operations/build/[^/\s]+/[^/\s]+|projects/[^/\s]+/locations/[^/\s]+/operations/[^/\s]+)",
    operation_name,
):
    raise SystemExit("Trigger run Operation name is invalid")
candidates = []
metadata = operation.get("metadata")
if isinstance(metadata, dict) and isinstance(metadata.get("build"), dict):
    if metadata.get("@type") != "type.googleapis.com/google.devtools.cloudbuild.v1.BuildOperationMetadata":
        raise SystemExit("Trigger run Operation metadata type is invalid")
    candidates.append(metadata["build"])
response = operation.get("response")
if isinstance(response, dict):
    if isinstance(response.get("build"), dict):
        candidates.append(response["build"])
    elif "id" in response:
        candidates.append(response)
if not candidates:
    raise SystemExit("Trigger run Operation contains no Build")

def identity(build):
    build_id = build.get("id")
    commit = build.get("substitutions", {}).get("COMMIT_SHA")
    if (
        not isinstance(build_id, str)
        or not build_id
        or build.get("projectId") != project_id
        or build.get("buildTriggerId") != trigger_id
        or not isinstance(commit, str)
        or commit.lower() != expected_commit
    ):
        raise SystemExit("Trigger run Operation Build identity is invalid")
    build_name = build.get("name")
    if build_name is not None and build_name != (
        f"projects/{project_id}/locations/{region}/builds/{build_id}"
    ):
        raise SystemExit("Trigger run Operation Build resource name is invalid")
    return build_id

build_ids = {identity(build) for build in candidates}
if len(build_ids) != 1:
    raise SystemExit("Trigger run Operation Build identities conflict")
print(operation_name, build_ids.pop())
PY
)"
  local operation_name build_id
  read -r operation_name build_id <<< "${operation_identity}"
  set_run_state accepted \
    "${normalized_sha}" "${operation_name}" "${build_id}"
  printf 'trigger_lifecycle=RUN operation_name=%s build_id=%s commit=%s\n' \
    "${operation_name}" "${build_id}" "${normalized_sha}"
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
