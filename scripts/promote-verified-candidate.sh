#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${PROMOTION_STATE_FILE:?PROMOTION_STATE_FILE is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${DEPLOY_REGION:?DEPLOY_REGION is required}"
: "${SERVICE_NAME:?SERVICE_NAME is required}"

PROMOTION_MODE="${PROMOTION_MODE:-promote}"
CANDIDATE_REVISION="${CANDIDATE_REVISION:-}"
CANDIDATE_TAG="${CANDIDATE_TAG:-}"
EXPECTED_IMAGE_DIGEST="${EXPECTED_IMAGE_DIGEST:-}"
EXPECTED_SOURCE_COMMIT="${EXPECTED_SOURCE_COMMIT:-}"
DEVICE_SMOKE_EVIDENCE="${DEVICE_SMOKE_EVIDENCE:-}"

case "${PROMOTION_MODE}" in
  promote)
    : "${CANDIDATE_REVISION:?CANDIDATE_REVISION is required}"
    : "${CANDIDATE_TAG:?CANDIDATE_TAG is required}"
    : "${EXPECTED_IMAGE_DIGEST:?EXPECTED_IMAGE_DIGEST is required}"
    : "${EXPECTED_SOURCE_COMMIT:?EXPECTED_SOURCE_COMMIT is required}"
    : "${DEVICE_SMOKE_EVIDENCE:?DEVICE_SMOKE_EVIDENCE is required}"
    ;;
  finalize | rollback) ;;
  *)
    printf 'promotion_mode=INVALID\n' >&2
    exit 1
    ;;
esac

if [[ "${PROMOTION_STATE_FILE}" != /* ]]; then
  printf 'promotion_state=INVALID absolute_path_required\n' >&2
  exit 1
fi
promotion_state_parent="$(dirname -- "${PROMOTION_STATE_FILE}")"
if [[ ! -d "${promotion_state_parent}" ]]; then
  printf 'promotion_state=INVALID parent_missing\n' >&2
  exit 1
fi
PROMOTION_STATE_FILE="$(cd -- "${promotion_state_parent}" && pwd -P)/$(basename -- "${PROMOTION_STATE_FILE}")"

RUNTIME_SERVICE_ACCOUNT=lifesnap-runtime@zhang23-23.iam.gserviceaccount.com
CANDIDATE_CONTAINER_CONCURRENCY=4
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "${script_directory}/.." && pwd -P)"
scratch_parent="${RELEASE_WORKSPACE:-${TMPDIR:-/tmp}}"
scratch_parent_requires_canonical=0
if [[ -n "${RELEASE_WORKSPACE:-}" ]]; then
  scratch_parent_requires_canonical=1
fi
release_workspace=""
service_api="https://${DEPLOY_REGION}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${PROJECT_ID}/services/${SERVICE_NAME}"
prepromotion_service_json=""
candidate_revision_json=""
promotion_payload_json=""
promotion_response_json=""
promotion_verified_json=""
rollback_payload_json=""
rollback_response_json=""
rollback_verified_json=""
pending_state_copy_json=""
access_token=""
evidence_sha256=""
production_revision_before_device_smoke=""
production_url=""
rollback_revision=""
promotion_owner=""
promoted_resource_version=""
prepromotion_resource_version=""
write_ahead_phase=""
promotion_write_ahead_started=0
pending_state_identity=""
scratch_validated=0
scratch_identity=""
promotion_lock_holder_pid=""
promotion_lock_acquired=0

validate_release_identity() {
  if [[ ! "${CANDIDATE_REVISION}" =~ ^[a-z][a-z0-9-]{0,62}$ ]]; then
    printf 'candidate_revision=INVALID\n' >&2
    return 1
  fi
  if [[ ! "${CANDIDATE_TAG}" =~ ^[a-z0-9-]{1,63}$ ]]; then
    printf 'candidate_tag=INVALID\n' >&2
    return 1
  fi
  if [[ ! "${EXPECTED_IMAGE_DIGEST}" =~ @sha256:[0-9a-f]{64}$ ]]; then
    printf 'image_digest=INVALID\n' >&2
    return 1
  fi
  if [[ ! "${EXPECTED_SOURCE_COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'source_commit=INVALID\n' >&2
    return 1
  fi
}

directory_identity() {
  python3 - "$1" <<'PY'
import os
import stat
import sys

details = os.lstat(sys.argv[1])
if not stat.S_ISDIR(details.st_mode):
    raise SystemExit(1)
print(f"{details.st_dev}:{details.st_ino}:{details.st_uid}")
PY
}

validate_release_workspace_parent() {
  python3 - "$1" "$2" <<'PY'
import os
import stat
import sys
from pathlib import Path

def fail(reason):
    print(f"promotion_workspace=INVALID {reason}", file=sys.stderr)
    raise SystemExit(1)

requested = Path(sys.argv[1])
require_canonical = sys.argv[2] == "1"
if not requested.is_absolute():
    fail("canonical_parent_required")
try:
    resolved = requested.resolve(strict=True)
except FileNotFoundError:
    fail("parent_missing")
if require_canonical and requested != resolved:
    fail("canonical_parent_required")
details = os.lstat(resolved)
if not stat.S_ISDIR(details.st_mode):
    fail("parent_not_directory")
mode = stat.S_IMODE(details.st_mode)
private_user_parent = (
    details.st_uid == os.getuid()
    and mode & (stat.S_IWGRP | stat.S_IWOTH) == 0
)
safe_root_sticky_shared_parent = (
    details.st_uid == 0
    and bool(details.st_mode & stat.S_ISVTX)
    and bool(mode & stat.S_IWOTH)
)
if not (private_user_parent or safe_root_sticky_shared_parent):
    fail("unsafe_parent")
if not os.access(resolved, os.W_OK | os.X_OK):
    fail("parent_not_accessible")
print(resolved)
PY
}

acquire_promotion_lock() {
  local lock_path="${PROMOTION_STATE_FILE}.lock"
  local lock_status="${release_workspace}/promotion-lock-status"
  python3 -c '
import fcntl
import os
import stat
import sys
import time

lock_path, status_path, parent_pid = sys.argv[1], sys.argv[2], int(sys.argv[3])
parent = os.path.dirname(lock_path)
if os.path.realpath(parent) != parent:
    raise SystemExit("Promotion lock parent must be canonical")
parent_details = os.lstat(parent)
if (
    not stat.S_ISDIR(parent_details.st_mode)
    or parent_details.st_uid != os.getuid()
    or stat.S_IMODE(parent_details.st_mode) != 0o700
):
    raise SystemExit("Promotion lock parent must be user-owned mode 0700")
flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
descriptor = os.open(lock_path, flags, 0o600)
try:
    details = os.fstat(descriptor)
    if (
        not stat.S_ISREG(details.st_mode)
        or details.st_uid != os.getuid()
        or stat.S_IMODE(details.st_mode) != 0o600
        or details.st_nlink != 1
    ):
        raise SystemExit("Promotion lock file must be user-owned mode 0600 with one link")
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        with open(status_path, "w") as status:
            status.write("BUSY\n")
        raise SystemExit(0)
    with open(status_path, "w") as status:
        status.write("LOCKED\n")
    while os.getppid() == parent_pid:
        time.sleep(0.02)
finally:
    os.close(descriptor)
' "${lock_path}" "${lock_status}" "$$" &
  promotion_lock_holder_pid="$!"

  local lock_result=""
  local attempt=0
  while [[ "${attempt}" -lt 200 ]]; do
    if [[ -s "${lock_status}" ]]; then
      IFS= read -r lock_result < "${lock_status}"
      break
    fi
    if ! kill -0 "${promotion_lock_holder_pid}" 2>/dev/null; then
      break
    fi
    sleep 0.01
    attempt=$((attempt + 1))
  done
  if [[ "${lock_result}" != "LOCKED" ]]; then
    wait "${promotion_lock_holder_pid}" 2>/dev/null || true
    promotion_lock_holder_pid=""
    if [[ "${lock_result}" == "BUSY" ]]; then
      printf 'promotion_lock=BUSY\n' >&2
    else
      printf 'promotion_lock=FAILED\n' >&2
    fi
    return 1
  fi
  promotion_lock_acquired=1
}

release_promotion_lock() {
  if [[ "${promotion_lock_acquired}" -eq 1 ]] &&
    [[ -n "${promotion_lock_holder_pid}" ]]; then
    kill -TERM "${promotion_lock_holder_pid}" 2>/dev/null || true
    wait "${promotion_lock_holder_pid}" 2>/dev/null || true
  fi
  promotion_lock_acquired=0
  promotion_lock_holder_pid=""
}

create_private_workspace() {
  scratch_parent="$(
    validate_release_workspace_parent \
      "${scratch_parent}" "${scratch_parent_requires_canonical}"
  )" || return $?
  release_workspace="$(mktemp -d "${scratch_parent}/lifesnap-promotion.XXXXXXXX")"
  if [[ ! -d "${release_workspace}" || -L "${release_workspace}" ]]; then
    printf 'promotion_workspace=INVALID scratch_type\n' >&2
    return 1
  fi
  if [[ "$(dirname -- "${release_workspace}")" != "${scratch_parent}" ]] ||
    [[ "$(basename -- "${release_workspace}")" != lifesnap-promotion.* ]]; then
    printf 'promotion_workspace=INVALID scratch_path\n' >&2
    return 1
  fi
  scratch_identity="$(directory_identity "${release_workspace}")"
  scratch_validated=1
  chmod 700 "${release_workspace}"
  prepromotion_service_json="${release_workspace}/initial.json"
  candidate_revision_json="${release_workspace}/candidate.json"
  promotion_payload_json="${release_workspace}/promotion-payload.json"
  promotion_response_json="${release_workspace}/promotion-response.json"
  promotion_verified_json="${release_workspace}/promotion-verified.json"
  rollback_payload_json="${release_workspace}/rollback-payload.json"
  rollback_response_json="${release_workspace}/rollback-response.json"
  rollback_verified_json="${release_workspace}/rollback-verified.json"
  pending_state_copy_json="${release_workspace}/pending-state.json"
}

cleanup_private_workspace() {
  local workspace="${release_workspace}"
  local current_identity=""
  if [[ "${scratch_validated}" -ne 1 ]]; then
    return 0
  fi
  scratch_validated=0
  if [[ ! -d "${workspace}" || -L "${workspace}" ]] ||
    [[ "$(dirname -- "${workspace}")" != "${scratch_parent}" ]] ||
    [[ "$(basename -- "${workspace}")" != lifesnap-promotion.* ]]; then
    printf 'promotion_workspace_cleanup=REFUSED invalid_target\n' >&2
    return 1
  fi
  current_identity="$(directory_identity "${workspace}")" || {
    printf 'promotion_workspace_cleanup=REFUSED identity_unavailable\n' >&2
    return 1
  }
  if [[ "${current_identity}" != "${scratch_identity}" ]]; then
    printf 'promotion_workspace_cleanup=REFUSED identity_changed\n' >&2
    return 1
  fi
  rm -rf -- "${workspace}"
}

validate_absent_pending_state() {
  python3 - "${PROMOTION_STATE_FILE}" <<'PY'
import os
import stat
import sys
from pathlib import Path

target = Path(sys.argv[1])
if not target.is_absolute():
    raise SystemExit("Promotion state path must be absolute")
parent = target.parent
resolved_parent = parent.resolve(strict=True)
if parent != resolved_parent or not resolved_parent.is_dir():
    raise SystemExit("Promotion state parent must be a real directory")
parent_details = os.lstat(resolved_parent)
if (
    not stat.S_ISDIR(parent_details.st_mode)
    or stat.S_IMODE(parent_details.st_mode) != 0o700
    or parent_details.st_uid != os.getuid()
):
    raise SystemExit("Promotion state parent must be user-owned mode 0700")
try:
    os.lstat(target)
except FileNotFoundError:
    pass
else:
    raise SystemExit("Promotion state already exists")
PY
}

persist_prepared_state() {
  python3 - \
    "${PROMOTION_STATE_FILE}" \
    "${prepromotion_service_json}" \
    "${PROJECT_ID}" \
    "${DEPLOY_REGION}" \
    "${SERVICE_NAME}" \
    "${CANDIDATE_REVISION}" \
    "${CANDIDATE_TAG}" \
    "${EXPECTED_IMAGE_DIGEST}" \
    "${EXPECTED_SOURCE_COMMIT}" \
    "${RUNTIME_SERVICE_ACCOUNT}" \
    "${CANDIDATE_CONTAINER_CONCURRENCY}" \
    "${promotion_owner}" <<'PY'
import json
import os
import stat
import sys
import tempfile
from pathlib import Path

(
    state_argument,
    initial_argument,
    project_id,
    deploy_region,
    service_name,
    candidate_revision,
    candidate_tag,
    expected_image_digest,
    expected_source_commit,
    runtime_service_account,
    candidate_container_concurrency,
    promotion_owner,
) = sys.argv[1:]
state_path = Path(state_argument)
parent = state_path.parent
if not state_path.is_absolute() or parent != parent.resolve(strict=True):
    raise SystemExit("Promotion state path is not canonical")
parent_details = os.lstat(parent)
if (
    not stat.S_ISDIR(parent_details.st_mode)
    or stat.S_IMODE(parent_details.st_mode) != 0o700
    or parent_details.st_uid != os.getuid()
):
    raise SystemExit("Promotion state parent must be user-owned mode 0700")
try:
    os.lstat(state_path)
except FileNotFoundError:
    pass
else:
    raise SystemExit("Promotion state already exists")

initial = json.loads(Path(initial_argument).read_text())
prepromotion_resource_version = initial.get("metadata", {}).get("resourceVersion")
if not isinstance(prepromotion_resource_version, str) or not prepromotion_resource_version:
    raise SystemExit("Pre-promotion resourceVersion is missing")

def normalized_traffic(document):
    return [
        {
            key: item[key]
            for key in ("revisionName", "latestRevision", "percent", "tag")
            if key in item
        }
        for item in document
    ]

provenance_keys = (
    "commit-sha",
    "gcb-build-id",
    "gcb-trigger-id",
    "gcb-trigger-region",
    "release-build",
    "source-commit",
    "managed-by",
    "product",
    "environment",
    "promotion-owner",
)
initial_labels = initial.get("metadata", {}).get("labels", {})
provenance = {
    key: initial_labels.get(key) if isinstance(initial_labels.get(key), str) else None
    for key in provenance_keys
}
state = {
    "schema_version": 2,
    "phase": "prepared",
    "project_id": project_id,
    "deploy_region": deploy_region,
    "service_name": service_name,
    "candidate_revision": candidate_revision,
    "candidate_tag": candidate_tag,
    "expected_image_digest": expected_image_digest,
    "expected_source_commit": expected_source_commit,
    "runtime_service_account": runtime_service_account,
    "candidate_container_concurrency": int(candidate_container_concurrency),
    "promotion_owner": promotion_owner,
    "prepromotion_resource_version": prepromotion_resource_version,
    "promoted_resource_version": None,
    "prepromotion_traffic": normalized_traffic(
        initial.get("spec", {}).get("traffic", [])
    ),
    "prepromotion_status_traffic": normalized_traffic(
        initial.get("status", {}).get("traffic", [])
    ),
    "prepromotion_provenance": provenance,
}
encoded = (json.dumps(state, sort_keys=True, separators=(",", ":")) + "\n").encode()
temporary_fd = -1
temporary_path = None
linked_identity = None
try:
    temporary_fd, temporary_name = tempfile.mkstemp(
        prefix=".lifesnap-promotion-state.",
        dir=parent,
    )
    temporary_path = Path(temporary_name)
    os.fchmod(temporary_fd, 0o600)
    with os.fdopen(temporary_fd, "wb", closefd=True) as handle:
        temporary_fd = -1
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    temporary_details = os.lstat(temporary_path)
    linked_identity = (
        temporary_details.st_dev,
        temporary_details.st_ino,
        temporary_details.st_uid,
    )
    os.link(temporary_path, state_path, follow_symlinks=False)
    os.unlink(temporary_path)
    temporary_path = None
    directory_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    details = os.lstat(state_path)
    if (
        not stat.S_ISREG(details.st_mode)
        or stat.S_IMODE(details.st_mode) != 0o600
        or details.st_uid != os.getuid()
        or details.st_nlink != 1
    ):
        raise SystemExit("Persisted promotion state is not private")
except BaseException:
    if temporary_fd >= 0:
        os.close(temporary_fd)
    if temporary_path is not None:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
    if linked_identity is not None:
        try:
            state_details = os.lstat(state_path)
            state_identity = (
                state_details.st_dev,
                state_details.st_ino,
                state_details.st_uid,
            )
            if state_identity == linked_identity and stat.S_ISREG(state_details.st_mode):
                os.unlink(state_path)
                directory_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        except FileNotFoundError:
            pass
    raise
PY
}

advance_state_to_pending_gate_e() {
  python3 - \
    "${PROMOTION_STATE_FILE}" \
    "${pending_state_identity}" \
    "${promotion_verified_json}" <<'PY'
import hashlib
import json
import os
import stat
import sys
import tempfile
from pathlib import Path

state_argument, expected_identity, promoted_argument = sys.argv[1:]
state_path = Path(state_argument)
parent = state_path.parent
parent_details = os.lstat(parent)
if (
    parent != parent.resolve(strict=True)
    or not stat.S_ISDIR(parent_details.st_mode)
    or stat.S_IMODE(parent_details.st_mode) != 0o700
    or parent_details.st_uid != os.getuid()
):
    raise SystemExit("Promotion state parent must be user-owned mode 0700")
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
fd = os.open(state_path, flags)
try:
    details = os.fstat(fd)
    raw = b""
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        raw += chunk
        if len(raw) > 65536:
            raise SystemExit("Promotion state is too large")
finally:
    os.close(fd)
identity = f"{details.st_dev}:{details.st_ino}:{details.st_uid}:{hashlib.sha256(raw).hexdigest()}"
if (
    identity != expected_identity
    or not stat.S_ISREG(details.st_mode)
    or stat.S_IMODE(details.st_mode) != 0o600
    or details.st_uid != os.getuid()
    or details.st_nlink != 1
):
    raise SystemExit("Promotion state identity changed before phase transition")

state = json.loads(raw.decode("utf-8"))
if state.get("schema_version") != 2 or state.get("phase") != "prepared":
    raise SystemExit("Promotion state is not in prepared phase")
if state.get("promoted_resource_version") is not None:
    raise SystemExit("Prepared promotion state already has a promoted resourceVersion")
promoted = json.loads(Path(promoted_argument).read_text())
promoted_resource_version = promoted.get("metadata", {}).get("resourceVersion")
if not isinstance(promoted_resource_version, str) or not promoted_resource_version:
    raise SystemExit("Promoted resourceVersion is missing")
state["phase"] = "pending_gate_e"
state["promoted_resource_version"] = promoted_resource_version
encoded = (json.dumps(state, sort_keys=True, separators=(",", ":")) + "\n").encode()

temporary_fd = -1
temporary_path = None
try:
    temporary_fd, temporary_name = tempfile.mkstemp(
        prefix=".lifesnap-promotion-state-transition.",
        dir=parent,
    )
    temporary_path = Path(temporary_name)
    os.fchmod(temporary_fd, 0o600)
    with os.fdopen(temporary_fd, "wb", closefd=True) as handle:
        temporary_fd = -1
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary_path, state_path)
    temporary_path = None
    directory_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    transitioned = os.lstat(state_path)
    if (
        not stat.S_ISREG(transitioned.st_mode)
        or stat.S_IMODE(transitioned.st_mode) != 0o600
        or transitioned.st_uid != os.getuid()
        or transitioned.st_nlink != 1
    ):
        raise SystemExit("Transitioned promotion state is not private")
except BaseException:
    if temporary_fd >= 0:
        os.close(temporary_fd)
    if temporary_path is not None:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
    raise
PY
}

load_pending_state() {
  local loaded
  loaded="$(
    python3 - \
      "${PROMOTION_STATE_FILE}" \
      "${pending_state_copy_json}" \
      "${PROJECT_ID}" \
      "${DEPLOY_REGION}" \
      "${SERVICE_NAME}" <<'PY'
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

state_argument, copy_argument, project_id, deploy_region, service_name = sys.argv[1:]
state_path = Path(state_argument)
if not state_path.is_absolute():
    raise SystemExit("Promotion state path must be absolute")
parent = state_path.parent
if parent != parent.resolve(strict=True):
    raise SystemExit("Promotion state parent must be canonical")
parent_details = os.lstat(parent)
if (
    not stat.S_ISDIR(parent_details.st_mode)
    or stat.S_IMODE(parent_details.st_mode) != 0o700
    or parent_details.st_uid != os.getuid()
):
    raise SystemExit("Promotion state parent must be user-owned mode 0700")
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
fd = os.open(state_path, flags)
try:
    details = os.fstat(fd)
    if (
        not stat.S_ISREG(details.st_mode)
        or stat.S_IMODE(details.st_mode) != 0o600
        or details.st_uid != os.getuid()
        or details.st_nlink != 1
        or details.st_size > 65536
    ):
        raise SystemExit("Promotion state is not a private regular file")
    raw = b""
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        raw += chunk
        if len(raw) > 65536:
            raise SystemExit("Promotion state is too large")
finally:
    os.close(fd)

state = json.loads(raw.decode("utf-8"))
expected_keys = {
    "schema_version",
    "phase",
    "project_id",
    "deploy_region",
    "service_name",
    "candidate_revision",
    "candidate_tag",
    "expected_image_digest",
    "expected_source_commit",
    "runtime_service_account",
    "candidate_container_concurrency",
    "promotion_owner",
    "prepromotion_resource_version",
    "promoted_resource_version",
    "prepromotion_traffic",
    "prepromotion_status_traffic",
    "prepromotion_provenance",
}
if not isinstance(state, dict) or set(state) != expected_keys:
    raise SystemExit("Promotion state schema is invalid")
if state.get("schema_version") != 2:
    raise SystemExit("Promotion state version is unsupported")
phase = state.get("phase")
if phase not in {"prepared", "pending_gate_e"}:
    raise SystemExit("Promotion state phase is invalid")
if (
    state.get("project_id") != project_id
    or state.get("deploy_region") != deploy_region
    or state.get("service_name") != service_name
):
    raise SystemExit("Promotion state service identity mismatch")

patterns = {
    "candidate_revision": r"[a-z][a-z0-9-]{0,62}",
    "candidate_tag": r"[a-z0-9-]{1,63}",
    "expected_image_digest": r"[^\t\r\n]+@sha256:[0-9a-f]{64}",
    "expected_source_commit": r"[0-9a-f]{40}",
    "runtime_service_account": r"[a-z0-9._%+-]+@[a-z0-9.-]+",
    "promotion_owner": r"[0-9a-f]{63}",
    "prepromotion_resource_version": r"[A-Za-z0-9._:+/-]{1,256}",
}
for key, pattern in patterns.items():
    value = state.get(key)
    if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
        raise SystemExit(f"Promotion state {key} is invalid")
promoted_resource_version = state.get("promoted_resource_version")
if phase == "prepared":
    if promoted_resource_version is not None:
        raise SystemExit("Prepared promotion state resourceVersion is invalid")
elif (
    not isinstance(promoted_resource_version, str)
    or re.fullmatch(r"[A-Za-z0-9._:+/-]{1,256}", promoted_resource_version) is None
):
    raise SystemExit("Pending promotion resourceVersion is invalid")
if state.get("candidate_container_concurrency") != 4:
    raise SystemExit("Promotion state concurrency is invalid")

def validate_traffic(name):
    traffic = state.get(name)
    if not isinstance(traffic, list) or not traffic:
        raise SystemExit(f"Promotion state {name} is invalid")
    for item in traffic:
        if not isinstance(item, dict) or not set(item).issubset(
            {"revisionName", "latestRevision", "percent", "tag"}
        ):
            raise SystemExit(f"Promotion state {name} is invalid")
        percent = item.get("percent")
        if not isinstance(percent, int) or not 0 <= percent <= 100:
            raise SystemExit(f"Promotion state {name} percent is invalid")
        revision_name = item.get("revisionName")
        latest_revision = item.get("latestRevision")
        if not (
            (isinstance(revision_name, str) and re.fullmatch(r"[a-z][a-z0-9-]{0,62}", revision_name))
            or latest_revision is True
        ):
            raise SystemExit(f"Promotion state {name} target is invalid")
        tag = item.get("tag")
        if tag is not None and (
            not isinstance(tag, str)
            or re.fullmatch(r"[a-z0-9-]{1,63}", tag) is None
        ):
            raise SystemExit(f"Promotion state {name} tag is invalid")
    return traffic

prepromotion_traffic = validate_traffic("prepromotion_traffic")
prepromotion_status_traffic = validate_traffic("prepromotion_status_traffic")
production = [
    item for item in prepromotion_traffic
    if item.get("percent") == 100 and isinstance(item.get("revisionName"), str)
]
if len(production) != 1 or sum(item["percent"] for item in prepromotion_traffic) != 100:
    raise SystemExit("Promotion state prepromotion traffic is invalid")
if sum(item["percent"] for item in prepromotion_status_traffic) != 100:
    raise SystemExit("Promotion state prepromotion status traffic is invalid")
provenance_keys = {
    "commit-sha",
    "gcb-build-id",
    "gcb-trigger-id",
    "gcb-trigger-region",
    "release-build",
    "source-commit",
    "managed-by",
    "product",
    "environment",
    "promotion-owner",
}
provenance = state.get("prepromotion_provenance")
if (
    not isinstance(provenance, dict)
    or set(provenance) != provenance_keys
    or any(value is not None and not isinstance(value, str) for value in provenance.values())
):
    raise SystemExit("Promotion state provenance is invalid")

copy_path = Path(copy_argument)
copy_path.write_text(json.dumps(state, sort_keys=True) + "\n")
os.chmod(copy_path, 0o600)
print("\t".join([
    state["phase"],
    state["candidate_revision"],
    state["candidate_tag"],
    state["expected_image_digest"],
    state["expected_source_commit"],
    state["runtime_service_account"],
    str(state["candidate_container_concurrency"]),
    state["promotion_owner"],
    state["prepromotion_resource_version"],
    state["promoted_resource_version"] or "-",
    production[0]["revisionName"],
    f"{details.st_dev}:{details.st_ino}:{details.st_uid}:{hashlib.sha256(raw).hexdigest()}",
]))
PY
  )"
  IFS=$'\t' read -r \
    write_ahead_phase \
    CANDIDATE_REVISION \
    CANDIDATE_TAG \
    EXPECTED_IMAGE_DIGEST \
    EXPECTED_SOURCE_COMMIT \
    RUNTIME_SERVICE_ACCOUNT \
    CANDIDATE_CONTAINER_CONCURRENCY \
    promotion_owner \
    prepromotion_resource_version \
    promoted_resource_version \
    rollback_revision \
    pending_state_identity <<< "${loaded}"
  if [[ "${promoted_resource_version}" == "-" ]]; then
    promoted_resource_version=""
  fi
  validate_release_identity
}

delete_pending_state() {
  python3 - "${PROMOTION_STATE_FILE}" "${pending_state_identity}" <<'PY'
import hashlib
import os
import stat
import sys
from pathlib import Path

path, expected_identity = sys.argv[1:]
state_path = Path(path)
parent = state_path.parent
if not state_path.is_absolute() or parent != parent.resolve(strict=True):
    raise SystemExit("Promotion state parent is no longer canonical")
parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
try:
    parent_details = os.fstat(parent_fd)
    if (
        not stat.S_ISDIR(parent_details.st_mode)
        or stat.S_IMODE(parent_details.st_mode) != 0o700
        or parent_details.st_uid != os.getuid()
    ):
        raise SystemExit("Promotion state parent is no longer private")
    fd = os.open(state_path.name, flags, dir_fd=parent_fd)
    try:
        details = os.fstat(fd)
        raw = b""
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            raw += chunk
            if len(raw) > 65536:
                raise SystemExit("Promotion state changed before deletion")
    finally:
        os.close(fd)
    identity = f"{details.st_dev}:{details.st_ino}:{details.st_uid}:{hashlib.sha256(raw).hexdigest()}"
    current = os.stat(state_path.name, dir_fd=parent_fd, follow_symlinks=False)
    current_identity = f"{current.st_dev}:{current.st_ino}:{current.st_uid}"
    expected_file_identity = ":".join(expected_identity.split(":")[:3])
    if (
        identity != expected_identity
        or current_identity != expected_file_identity
        or not stat.S_ISREG(details.st_mode)
        or stat.S_IMODE(details.st_mode) != 0o600
        or details.st_uid != os.getuid()
        or details.st_nlink != 1
    ):
        raise SystemExit("Promotion state identity changed")
    os.unlink(state_path.name, dir_fd=parent_fd)
    os.fsync(parent_fd)
finally:
    os.close(parent_fd)
PY
}

validate_device_evidence() {
  local validation
  validation="$(
    python3 - \
      "${DEVICE_SMOKE_EVIDENCE}" \
      "${CANDIDATE_REVISION}" \
      "${CANDIDATE_TAG}" \
      "${EXPECTED_IMAGE_DIGEST}" \
      "${EXPECTED_SOURCE_COMMIT}" \
      "${repo_root}" <<'PY'
import hashlib
import re
import sys
from pathlib import Path

(
    evidence_argument,
    expected_candidate_revision,
    expected_candidate_tag,
    expected_image_digest,
    expected_source_commit,
    repo_root_argument,
) = sys.argv[1:]
repo_root = Path(repo_root_argument).resolve(strict=True)
allowed_root = (repo_root / "docs/verification/yotei-snap-security").resolve()
evidence = Path(evidence_argument)
if not evidence.is_absolute():
    evidence = repo_root / evidence
try:
    evidence = evidence.resolve(strict=True)
except FileNotFoundError:
    raise SystemExit("Device smoke evidence is outside the approved directory or missing")
try:
    evidence.relative_to(allowed_root)
except ValueError:
    raise SystemExit("Device smoke evidence is outside the approved directory")
if not evidence.is_file():
    raise SystemExit("Device smoke evidence is not a regular file")

raw = evidence.read_bytes()
text = raw.decode("utf-8")
expected = {
    "app_attest_provider": "PASS",
    "v2_extract": "PASS",
    "replay_rejected": "PASS",
    "gemini_valid_request_count": "1",
    "gemini_replay_request_count": "0",
    "candidate_revision": expected_candidate_revision,
    "candidate_tag": expected_candidate_tag,
    "image_digest": expected_image_digest,
    "source_commit": expected_source_commit,
}
allowed_keys = {*expected, "production_revision_before_device_smoke"}
fields = {}
for line in text.splitlines():
    if not line or "=" not in line:
        raise SystemExit("Evidence must contain only non-empty key=value lines")
    key, value = line.split("=", 1)
    if key not in allowed_keys:
        raise SystemExit("Evidence field is not allowed")
    if key in fields:
        raise SystemExit("Evidence field is duplicated")
    fields[key] = value
if set(fields) != allowed_keys:
    raise SystemExit("Evidence required field is missing")
for key, expected_value in expected.items():
    if fields[key] != expected_value:
        if key in {"candidate_revision", "candidate_tag", "image_digest", "source_commit"}:
            raise SystemExit("Evidence candidate identity mismatch")
        raise SystemExit("Evidence required value mismatch")

production_revision = fields["production_revision_before_device_smoke"]
if not re.fullmatch(r"[a-z][a-z0-9-]{0,62}", production_revision):
    raise SystemExit("Pre-smoke production revision is invalid")

print(hashlib.sha256(raw).hexdigest(), production_revision)
PY
  )"
  read -r evidence_sha256 production_revision_before_device_smoke \
    <<< "${validation}"
  promotion_owner="${evidence_sha256:0:63}"
  printf 'evidence_sha256=%s\n' "${evidence_sha256}"
}

api_get_service() {
  local destination="$1"
  curl --fail --silent --show-error \
    --header "Authorization: Bearer ${access_token}" \
    --output "${destination}" \
    "${service_api}"
}

conditional_replace() {
  local payload="$1"
  local response="$2"
  curl --fail --silent --show-error \
    --request PUT \
    --header "Authorization: Bearer ${access_token}" \
    --header "Content-Type: application/json" \
    --data-binary "@${payload}" \
    --output "${response}" \
    "${service_api}"
}

capture_and_validate_candidate() {
  api_get_service "${prepromotion_service_json}"
  gcloud run revisions describe "${CANDIDATE_REVISION}" \
    --project="${PROJECT_ID}" \
    --region="${DEPLOY_REGION}" \
    --format=json > "${candidate_revision_json}"

  read -r rollback_revision production_url < <(
    python3 - \
      "${prepromotion_service_json}" \
      "${candidate_revision_json}" \
      "${CANDIDATE_REVISION}" \
      "${CANDIDATE_TAG}" \
      "${EXPECTED_IMAGE_DIGEST}" \
      "${EXPECTED_SOURCE_COMMIT}" \
      "${RUNTIME_SERVICE_ACCOUNT}" \
      "${CANDIDATE_CONTAINER_CONCURRENCY}" \
      "${production_revision_before_device_smoke}" <<'PY'
import json
import sys
from pathlib import Path

(
    service_path,
    revision_path,
    candidate_revision,
    candidate_tag,
    expected_digest,
    expected_source_commit,
    runtime_service_account,
    expected_container_concurrency,
    production_before_smoke,
) = sys.argv[1:]
service = json.loads(Path(service_path).read_text())
revision = json.loads(Path(revision_path).read_text())
metadata = service.get("metadata", {})
if not metadata.get("resourceVersion"):
    raise SystemExit("Promotion service resourceVersion is missing")
conditions = service.get("status", {}).get("conditions", [])
if not any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in conditions
):
    raise SystemExit("Cloud Run service is not ready before promotion")

traffic = service.get("spec", {}).get("traffic", [])
production = [
    item for item in traffic
    if item.get("percent", 0) == 100 and item.get("revisionName")
]
if len(production) != 1 or sum(item.get("percent", 0) for item in traffic) != 100:
    raise SystemExit("Expected one exclusive production revision")
if production[0]["revisionName"] != production_before_smoke:
    raise SystemExit("Production changed after device smoke began")

candidate_spec = [item for item in traffic if item.get("tag") == candidate_tag]
if (
    len(candidate_spec) != 1
    or candidate_spec[0].get("percent", 0) != 0
    or not (
        candidate_spec[0].get("revisionName") == candidate_revision
        or candidate_spec[0].get("latestRevision") is True
    )
):
    raise SystemExit("Exact zero-traffic candidate tag is missing")
candidate_status = [
    item for item in service.get("status", {}).get("traffic", [])
    if item.get("tag") == candidate_tag
]
if (
    len(candidate_status) != 1
    or candidate_status[0].get("percent", 0) != 0
    or candidate_status[0].get("revisionName") != candidate_revision
):
    raise SystemExit("Candidate tag does not resolve to the expected revision")

labels = revision.get("metadata", {}).get("labels", {})
if labels.get("source-commit") != expected_source_commit:
    raise SystemExit("Candidate source commit mismatch")
if labels.get("api-contract") != "v2-app-check":
    raise SystemExit("Candidate API contract mismatch")
if revision.get("status", {}).get("imageDigest") != expected_digest:
    raise SystemExit("Candidate image digest mismatch")
if revision.get("spec", {}).get("serviceAccountName") != runtime_service_account:
    raise SystemExit("Candidate runtime identity mismatch")
if revision.get("spec", {}).get("containerConcurrency") != int(expected_container_concurrency):
    raise SystemExit("Candidate container concurrency mismatch")
revision_conditions = revision.get("status", {}).get("conditions", [])
if not any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in revision_conditions
):
    raise SystemExit("Candidate revision is not ready")
service_url = service.get("status", {}).get("url")
if not service_url:
    raise SystemExit("Production service URL is missing")
print(production[0]["revisionName"], service_url)
PY
  )
}

prepare_promotion_payload() {
  python3 - \
    "${prepromotion_service_json}" \
    "${promotion_payload_json}" \
    "${CANDIDATE_REVISION}" \
    "${EXPECTED_SOURCE_COMMIT}" \
    "${promotion_owner}" <<'PY'
import copy
import json
import sys
from pathlib import Path

source_path, payload_path, candidate_revision, source_commit, owner = sys.argv[1:]
current = json.loads(Path(source_path).read_text())
metadata = current["metadata"]
labels = dict(metadata.get("labels", {}))
for stale_key in (
    "commit-sha",
    "gcb-build-id",
    "gcb-trigger-id",
    "gcb-trigger-region",
    "release-build",
):
    labels.pop(stale_key, None)
labels.update({
    "source-commit": source_commit,
    "managed-by": "verified-device-promotion",
    "product": "lifesnap-action",
    "environment": "production",
    "promotion-owner": owner,
})
spec = copy.deepcopy(current["spec"])
spec["traffic"] = [
    {
        "revisionName": candidate_revision,
        "percent": 100,
    }
]
payload = {
    "apiVersion": current["apiVersion"],
    "kind": current["kind"],
    "metadata": {
        "name": metadata["name"],
        "namespace": metadata["namespace"],
        "labels": labels,
        "annotations": metadata.get("annotations", {}),
        "resourceVersion": metadata["resourceVersion"],
    },
    "spec": spec,
}
Path(payload_path).write_text(json.dumps(payload) + "\n")
PY
}

assert_promoted() {
  local service_json="$1"
  python3 - \
    "${service_json}" \
    "${CANDIDATE_REVISION}" \
    "${EXPECTED_SOURCE_COMMIT}" \
    "${promotion_owner}" <<'PY'
import json
import sys
from pathlib import Path

path, candidate_revision, source_commit, owner = sys.argv[1:]
service = json.loads(Path(path).read_text())
labels = service.get("metadata", {}).get("labels", {})
if labels.get("source-commit") != source_commit or labels.get("promotion-owner") != owner:
    raise SystemExit("Promotion ownership labels are missing")
expected_traffic = [{"revisionName": candidate_revision, "percent": 100}]
if service.get("spec", {}).get("traffic", []) != expected_traffic:
    raise SystemExit("Candidate is not the exclusive untagged production target")
status_traffic = [
    {key: item[key] for key in ("revisionName", "percent", "tag") if key in item}
    for item in service.get("status", {}).get("traffic", [])
]
if status_traffic != expected_traffic:
    raise SystemExit("Candidate production traffic has not reconciled")
conditions = service.get("status", {}).get("conditions", [])
if not any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in conditions
):
    raise SystemExit("Promoted service is not ready")
PY
}

wait_for_promotion() {
  local attempt
  local max_attempts="${PROMOTION_MAX_ATTEMPTS:-90}"
  local poll_interval="${PROMOTION_POLL_INTERVAL_SECONDS:-2}"
  if [[ ! "${max_attempts}" =~ ^[1-9][0-9]*$ ]] ||
    [[ ! "${poll_interval}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    printf 'promotion_reconciliation=INVALID_POLL_CONFIG\n' >&2
    return 1
  fi
  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    api_get_service "${promotion_verified_json}"
    if assert_promoted "${promotion_verified_json}" 2>/dev/null; then
      return 0
    fi
    sleep "${poll_interval}"
  done
  printf 'promotion_reconciliation=TIMEOUT\n' >&2
  return 1
}

assert_pending_rollback_owned() {
  local service_json="$1"
  local revision_json="$2"
  python3 - \
    "${pending_state_copy_json}" \
    "${service_json}" \
    "${revision_json}" <<'PY'
import json
import sys
from pathlib import Path

state_path, service_path, revision_path = sys.argv[1:]
state = json.loads(Path(state_path).read_text())
service = json.loads(Path(service_path).read_text())
revision = json.loads(Path(revision_path).read_text())
metadata = service.get("metadata", {})
resource_version = metadata.get("resourceVersion")
if not isinstance(resource_version, str) or not resource_version:
    raise SystemExit("Pending promotion current resourceVersion is missing")
labels = metadata.get("labels", {})
if (
    labels.get("source-commit") != state["expected_source_commit"]
    or labels.get("promotion-owner") != state["promotion_owner"]
):
    raise SystemExit("Pending promotion ownership labels no longer match")
expected_traffic = [
    {"revisionName": state["candidate_revision"], "percent": 100}
]
if service.get("spec", {}).get("traffic", []) != expected_traffic:
    raise SystemExit("Pending promotion traffic no longer matches")

if revision.get("metadata", {}).get("name") != state["candidate_revision"]:
    raise SystemExit("Pending candidate revision identity no longer matches")
revision_labels = revision.get("metadata", {}).get("labels", {})
if revision_labels.get("source-commit") != state["expected_source_commit"]:
    raise SystemExit("Pending candidate source commit no longer matches")
if revision_labels.get("api-contract") != "v2-app-check":
    raise SystemExit("Pending candidate API contract no longer matches")
if revision.get("status", {}).get("imageDigest") != state["expected_image_digest"]:
    raise SystemExit("Pending candidate image digest no longer matches")
revision_spec = revision.get("spec", {})
if revision_spec.get("serviceAccountName") != state["runtime_service_account"]:
    raise SystemExit("Pending candidate runtime identity no longer matches")
if revision_spec.get("containerConcurrency") != state["candidate_container_concurrency"]:
    raise SystemExit("Pending candidate concurrency no longer matches")
PY
}

assert_pending_finalize_resource_version() {
  local service_json="$1"
  python3 - \
    "${pending_state_copy_json}" \
    "${service_json}" <<'PY'
import json
import sys
from pathlib import Path

state_path, service_path = sys.argv[1:]
state = json.loads(Path(state_path).read_text())
service = json.loads(Path(service_path).read_text())
if service.get("metadata", {}).get("resourceVersion") != state["promoted_resource_version"]:
    raise SystemExit("Pending promotion resourceVersion no longer matches")
PY
}

assert_pending_promotion_healthy() {
  local service_json="$1"
  local revision_json="$2"
  python3 - \
    "${pending_state_copy_json}" \
    "${service_json}" \
    "${revision_json}" <<'PY'
import json
import sys
from pathlib import Path

state_path, service_path, revision_path = sys.argv[1:]
state = json.loads(Path(state_path).read_text())
service = json.loads(Path(service_path).read_text())
revision = json.loads(Path(revision_path).read_text())
expected_traffic = [
    {"revisionName": state["candidate_revision"], "percent": 100}
]

def normalized_traffic(items):
    return [
        {
            key: item[key]
            for key in ("revisionName", "latestRevision", "percent", "tag")
            if key in item
        }
        for item in items
    ]

if normalized_traffic(service.get("status", {}).get("traffic", [])) != expected_traffic:
    raise SystemExit("Pending promotion status traffic no longer matches")
service_conditions = service.get("status", {}).get("conditions", [])
if not any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in service_conditions
):
    raise SystemExit("Pending promoted service is not ready")
revision_conditions = revision.get("status", {}).get("conditions", [])
if not any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in revision_conditions
):
    raise SystemExit("Pending candidate revision is not ready")
PY
}

classify_write_ahead_recovery() {
  local service_json="$1"
  python3 - \
    "${service_json}" \
    "${pending_state_copy_json}" <<'PY'
import json
import sys
from pathlib import Path

service_path, state_path = sys.argv[1:]
service = json.loads(Path(service_path).read_text())
state = json.loads(Path(state_path).read_text())
metadata = service.get("metadata", {})
labels = metadata.get("labels", {})
traffic = service.get("spec", {}).get("traffic", [])

prepromotion_provenance_matches = True
for key, value in state["prepromotion_provenance"].items():
    if value is None:
        prepromotion_provenance_matches = (
            prepromotion_provenance_matches and key not in labels
        )
    else:
        prepromotion_provenance_matches = (
            prepromotion_provenance_matches and labels.get(key) == value
        )
if (
    traffic == state["prepromotion_traffic"]
    and prepromotion_provenance_matches
):
    print("prepromotion")
    raise SystemExit(0)

expected_promoted_traffic = [
    {"revisionName": state["candidate_revision"], "percent": 100}
]
owned_promoted = (
    traffic == expected_promoted_traffic
    and labels.get("source-commit") == state["expected_source_commit"]
    and labels.get("promotion-owner") == state["promotion_owner"]
)
if owned_promoted:
    print("promoted")
    raise SystemExit(0)

raise SystemExit("Promotion recovery state is foreign or ambiguous")
PY
}

prepare_pending_rollback_payload() {
  local current_json="$1"
  python3 - \
    "${current_json}" \
    "${pending_state_copy_json}" \
    "${rollback_payload_json}" <<'PY'
import copy
import json
import sys
from pathlib import Path

current_path, state_path, payload_path = sys.argv[1:]
current = json.loads(Path(current_path).read_text())
state = json.loads(Path(state_path).read_text())
metadata = current.get("metadata", {})
labels = metadata.get("labels", {})
expected_traffic = [
    {"revisionName": state["candidate_revision"], "percent": 100}
]
if (
    labels.get("source-commit") != state["expected_source_commit"]
    or labels.get("promotion-owner") != state["promotion_owner"]
    or current.get("spec", {}).get("traffic", []) != expected_traffic
):
    raise SystemExit("Pending promotion is no longer exclusively owned")

restored_labels = dict(labels)
for key, value in state["prepromotion_provenance"].items():
    if value is None:
        restored_labels.pop(key, None)
    else:
        restored_labels[key] = value
restored_spec = copy.deepcopy(current["spec"])
restored_spec["traffic"] = copy.deepcopy(state["prepromotion_traffic"])
payload = {
    "apiVersion": current["apiVersion"],
    "kind": current["kind"],
    "metadata": {
        "name": metadata["name"],
        "namespace": metadata["namespace"],
        "labels": restored_labels,
        "annotations": metadata.get("annotations", {}),
        "resourceVersion": metadata["resourceVersion"],
    },
    "spec": restored_spec,
}
Path(payload_path).write_text(json.dumps(payload) + "\n")
PY
}

assert_prepromotion_reconciled() {
  local service_json="$1"
  python3 - \
    "${service_json}" \
    "${pending_state_copy_json}" <<'PY'
import json
import sys
from pathlib import Path

service_path, state_path = sys.argv[1:]
service = json.loads(Path(service_path).read_text())
state = json.loads(Path(state_path).read_text())
if service.get("spec", {}).get("traffic", []) != state["prepromotion_traffic"]:
    raise SystemExit("Pending rollback spec traffic has not reconciled")
labels = service.get("metadata", {}).get("labels", {})
for key, value in state["prepromotion_provenance"].items():
    if value is None:
        if key in labels:
            raise SystemExit("Pending rollback provenance has not reconciled")
    elif labels.get(key) != value:
        raise SystemExit("Pending rollback provenance has not reconciled")

def normalized_traffic(items):
    return [
        {
            key: item[key]
            for key in ("revisionName", "latestRevision", "percent", "tag")
            if key in item
        }
        for item in items
    ]

if normalized_traffic(service.get("status", {}).get("traffic", [])) != state["prepromotion_status_traffic"]:
    raise SystemExit("Pending rollback status traffic has not reconciled")
conditions = service.get("status", {}).get("conditions", [])
if not any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in conditions
):
    raise SystemExit("Pending rolled back service is not ready")
generation = service.get("metadata", {}).get("generation")
observed_generation = service.get("status", {}).get("observedGeneration")
if not isinstance(generation, int) or not isinstance(observed_generation, int):
    raise SystemExit("Pending rollback generation observation is missing")
if observed_generation < generation:
    raise SystemExit("Pending rollback generation has not been observed")
PY
}

wait_for_pending_rollback_reconciliation() {
  local attempt
  local max_attempts="${ROLLBACK_MAX_ATTEMPTS:-90}"
  local poll_interval="${ROLLBACK_POLL_INTERVAL_SECONDS:-2}"
  if [[ ! "${max_attempts}" =~ ^[1-9][0-9]*$ ]] ||
    [[ ! "${poll_interval}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    printf 'promotion_rollback_reconciliation=INVALID_POLL_CONFIG\n' >&2
    return 1
  fi
  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    if api_get_service "${rollback_verified_json}" &&
      assert_prepromotion_reconciled "${rollback_verified_json}" 2>/dev/null; then
      return 0
    fi
    sleep "${poll_interval}"
  done
  printf 'promotion_rollback_reconciliation=TIMEOUT attempts=%s\n' \
    "${max_attempts}" >&2
  return 1
}

describe_pending_candidate() {
  gcloud run revisions describe "${CANDIDATE_REVISION}" \
    --project="${PROJECT_ID}" \
    --region="${DEPLOY_REGION}" \
    --format=json > "${candidate_revision_json}"
}

finalize_pending_promotion() {
  load_pending_state
  if [[ "${write_ahead_phase}" != "pending_gate_e" ]]; then
    printf 'promotion_finalize=REFUSED phase_must_be_pending_gate_e\n' >&2
    return 1
  fi
  access_token="$(gcloud auth print-access-token)"
  api_get_service "${promotion_verified_json}"
  describe_pending_candidate
  assert_pending_finalize_resource_version "${promotion_verified_json}"
  assert_pending_rollback_owned \
    "${promotion_verified_json}" \
    "${candidate_revision_json}"
  assert_pending_promotion_healthy \
    "${promotion_verified_json}" \
    "${candidate_revision_json}"
  trap '' INT TERM
  delete_pending_state
  printf 'promotion_finalize=PASS revision=%s\n' "${CANDIDATE_REVISION}"
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

recover_write_ahead_state() {
  local current_json="${release_workspace}/pending-rollback-current.json"
  local recovery_classification=""
  load_pending_state || return $?
  if [[ -z "${access_token}" ]]; then
    access_token="$(gcloud auth print-access-token)" || return $?
  fi
  api_get_service "${current_json}" || return $?
  recovery_classification="$(classify_write_ahead_recovery "${current_json}")" || return $?
  case "${recovery_classification}" in
    prepromotion)
      wait_for_pending_rollback_reconciliation || return $?
      ;;
    promoted)
      describe_pending_candidate || return $?
      assert_pending_rollback_owned \
        "${current_json}" "${candidate_revision_json}" || return $?
      prepare_pending_rollback_payload "${current_json}" || return $?
      conditional_replace \
        "${rollback_payload_json}" "${rollback_response_json}" || return $?
      wait_for_pending_rollback_reconciliation || return $?
      ;;
    *)
      printf 'promotion_recovery=REFUSED foreign_or_ambiguous\n' >&2
      return 1
      ;;
  esac
  trap '' INT TERM
  delete_pending_state || return $?
  if [[ "${recovery_classification}" == "prepromotion" ]]; then
    printf 'promotion_rollback=PASS revision=%s already_prepromotion=true\n' \
      "${rollback_revision}" >&2
  else
    printf 'promotion_rollback=PASS revision=%s\n' "${rollback_revision}" >&2
  fi
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

rollback_pending_promotion() {
  recover_write_ahead_state
}

verify_negative_v2_response() {
  local name="$1"
  local expected_code="$2"
  shift 2
  local headers="${release_workspace}/lifesnap-production-${name}-headers.txt"
  local body="${release_workspace}/lifesnap-production-${name}.json"
  local status
  status="$(
    curl --silent --show-error \
      --dump-header "${headers}" \
      --output "${body}" \
      --write-out '%{http_code}' \
      --form "image=@${repo_root}/test-assets/service_notice.png;type=image/png" \
      "$@" \
      "${production_url}/api/v2/extract"
  )"
  python3 - "${headers}" "${body}" "${status}" "${expected_code}" <<'PY'
import json
import sys
from pathlib import Path

headers_path, body_path, status, expected_code = sys.argv[1:]
if status != "401":
    raise SystemExit("Production negative v2 smoke did not return 401")

def has_exact_no_store_header(path):
    blocks = []
    current = []
    for line in Path(path).read_text().splitlines():
        if line.startswith("HTTP/"):
            if current:
                blocks.append(current)
            current = [line]
        elif current and line == "":
            blocks.append(current)
            current = []
        elif current:
            current.append(line)
    if current:
        blocks.append(current)
    if not blocks:
        return False
    values = []
    for line in blocks[-1][1:]:
        if line.startswith((" ", "\t")) or ":" not in line:
            return False
        name, value = line.split(":", 1)
        if name.lower() == "cache-control":
            values.append(value)
    if not values:
        return False
    directives = [
        directive.strip().lower()
        for value in values
        for directive in value.split(",")
    ]
    return bool(directives) and all(directives) and "no-store" in directives

if not has_exact_no_store_header(headers_path):
    raise SystemExit("Production negative v2 smoke is cacheable")
body = json.loads(Path(body_path).read_text())
if (
    not isinstance(body, dict)
    or body.get("code") != expected_code
    or not isinstance(body.get("error"), str)
):
    raise SystemExit("Production negative v2 smoke returned an unstable code")
PY
}

verify_production_endpoints() {
  curl --fail --silent --show-error \
    --output "${release_workspace}/lifesnap-production-health.json" \
    "${production_url}/health"
  curl --fail --silent --show-error \
    --output "${release_workspace}/lifesnap-production-privacy.html" \
    "${production_url}/privacy"
  python3 - "${release_workspace}/lifesnap-production-privacy.html" <<'PY'
import sys
from pathlib import Path

privacy = Path(sys.argv[1]).read_text()
required_markers = (
    '<html lang="ja">',
    '<title>よていスナップ プライバシーポリシー</title>',
    'Last updated:',
)
if not all(marker in privacy for marker in required_markers):
    raise SystemExit("Production privacy page identity is invalid")
PY
  verify_negative_v2_response "missing-token" "APP_CHECK_REQUIRED"
  verify_negative_v2_response \
    "invalid-token" "APP_CHECK_INVALID" \
    --header "X-Firebase-AppCheck: invalid"
  python3 - "${release_workspace}/lifesnap-production-health.json" <<'PY'
import json
import sys
from pathlib import Path

if json.loads(Path(sys.argv[1]).read_text()).get("status") != "ok":
    raise SystemExit("Production health response is not ok")
PY
}

on_exit() {
  local exit_code="$1"
  local recovery_result=0
  local cleanup_result=0
  trap - ERR INT TERM EXIT
  if [[ "${exit_code}" -ne 0 && "${promotion_write_ahead_started}" -eq 1 ]] &&
    [[ -e "${PROMOTION_STATE_FILE}" || -L "${PROMOTION_STATE_FILE}" ]]; then
    recover_write_ahead_state || recovery_result=$?
    if [[ "${recovery_result}" -ne 0 ]]; then
      printf 'promotion_rollback=FAILED code=%s\n' "${recovery_result}" >&2
      printf 'promotion_recovery=FAILED code=%s\n' "${recovery_result}" >&2
    fi
  fi
  cleanup_private_workspace || cleanup_result=$?
  if [[ "${cleanup_result}" -ne 0 ]]; then
    printf 'promotion_workspace_cleanup=FAILED code=%s\n' \
      "${cleanup_result}" >&2
  fi
  release_promotion_lock
  if [[ "${exit_code}" -eq 0 && "${cleanup_result}" -ne 0 ]]; then
    exit_code="${cleanup_result}"
  fi
  exit "${exit_code}"
}

trap 'exit 130' INT
trap 'exit 143' TERM
trap 'on_exit $?' EXIT
create_private_workspace
acquire_promotion_lock
case "${PROMOTION_MODE}" in
  promote)
    validate_release_identity
    validate_absent_pending_state
    validate_device_evidence
    access_token="$(gcloud auth print-access-token)"
    capture_and_validate_candidate
    prepare_promotion_payload
    promotion_write_ahead_started=1
    persist_prepared_state
    load_pending_state
    conditional_replace "${promotion_payload_json}" "${promotion_response_json}"
    wait_for_promotion
    verify_production_endpoints
    api_get_service "${promotion_verified_json}"
    assert_promoted "${promotion_verified_json}"
    trap '' INT TERM
    advance_state_to_pending_gate_e
    load_pending_state
    promotion_write_ahead_started=0
    printf 'promotion_result=PENDING_GATE_E revision=%s\n' "${CANDIDATE_REVISION}"
    printf 'promotion_rollback_revision=%s\n' "${rollback_revision}"
    trap 'exit 130' INT
    trap 'exit 143' TERM
    ;;
  finalize)
    finalize_pending_promotion
    ;;
  rollback)
    rollback_pending_promotion
    ;;
esac
