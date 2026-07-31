#!/usr/bin/env bash
set -Eeuo pipefail

: "${CANDIDATE_REVISION:?CANDIDATE_REVISION is required}"
: "${CANDIDATE_TAG:?CANDIDATE_TAG is required}"
: "${EXPECTED_IMAGE_DIGEST:?EXPECTED_IMAGE_DIGEST is required}"
: "${EXPECTED_SOURCE_COMMIT:?EXPECTED_SOURCE_COMMIT is required}"
: "${DEVICE_SMOKE_EVIDENCE:?DEVICE_SMOKE_EVIDENCE is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${DEPLOY_REGION:?DEPLOY_REGION is required}"
: "${SERVICE_NAME:?SERVICE_NAME is required}"

RUNTIME_SERVICE_ACCOUNT=lifesnap-runtime@zhang23-23.iam.gserviceaccount.com
release_workspace="${RELEASE_WORKSPACE:-/tmp}"
service_api="https://${DEPLOY_REGION}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${PROJECT_ID}/services/${SERVICE_NAME}"
prepromotion_service_json="${release_workspace}/lifesnap-promotion-initial.json"
candidate_revision_json="${release_workspace}/lifesnap-promotion-candidate.json"
promotion_payload_json="${release_workspace}/lifesnap-promotion-payload.json"
promotion_response_json="${release_workspace}/lifesnap-promotion-response.json"
promotion_verified_json="${release_workspace}/lifesnap-promotion-verified.json"
rollback_payload_json="${release_workspace}/lifesnap-promotion-rollback-payload.json"
rollback_response_json="${release_workspace}/lifesnap-promotion-rollback-response.json"
rollback_verified_json="${release_workspace}/lifesnap-promotion-rollback-verified.json"
access_token=""
evidence_sha256=""
production_revision_before_device_smoke=""
production_url=""
rollback_revision=""
promotion_owner=""
promotion_mutation_started=0

if [[ ! "${CANDIDATE_REVISION}" =~ ^[a-z][a-z0-9-]{0,62}$ ]]; then
  printf 'candidate_revision=INVALID\n' >&2
  exit 1
fi
if [[ ! "${CANDIDATE_TAG}" =~ ^[a-z0-9-]{1,63}$ ]]; then
  printf 'candidate_tag=INVALID\n' >&2
  exit 1
fi
if [[ ! "${EXPECTED_IMAGE_DIGEST}" =~ @sha256:[0-9a-f]{64}$ ]]; then
  printf 'image_digest=INVALID\n' >&2
  exit 1
fi
if [[ ! "${EXPECTED_SOURCE_COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'source_commit=INVALID\n' >&2
  exit 1
fi

validate_device_evidence() {
  local validation
  validation="$(
    python3 - "${DEVICE_SMOKE_EVIDENCE}" <<'PY'
import hashlib
import re
import sys
from pathlib import Path

repo_root = Path.cwd().resolve()
allowed_root = (repo_root / "docs/verification/yotei-snap-security").resolve()
evidence = Path(sys.argv[1])
if not evidence.is_absolute():
    evidence = repo_root / evidence
evidence = evidence.resolve(strict=True)
try:
    evidence.relative_to(allowed_root)
except ValueError:
    raise SystemExit("Device smoke evidence is outside the approved directory")
if not evidence.is_file():
    raise SystemExit("Device smoke evidence is not a regular file")

raw = evidence.read_bytes()
text = raw.decode("utf-8")
for required in (
    "app_attest_provider=PASS",
    "v2_extract=PASS",
    "replay_rejected=PASS",
    "gemini_valid_request_count=1",
    "gemini_replay_request_count=0",
):
    if text.splitlines().count(required) != 1:
        raise SystemExit(f"Missing or duplicate required evidence field: {required}")

forbidden = re.compile(
    r"(?i)(app.?check.?token|x-firebase-appcheck|authorization|bearer|"
    r"installation.?(id|uuid|hmac)|image.?(data|content|bytes)|base64|"
    r"request.?(body|header)|response.?body|extracted.?(json|field)|gemini.?(raw|response))"
)
if forbidden.search(text):
    raise SystemExit("Device smoke evidence contains a forbidden field")

production_lines = [
    line for line in text.splitlines()
    if line.startswith("production_revision_before_device_smoke=")
]
if len(production_lines) != 1:
    raise SystemExit("Evidence must identify one pre-smoke production revision")
production_revision = production_lines[0].split("=", 1)[1]
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
  for ((attempt = 1; attempt <= 90; attempt += 1)); do
    api_get_service "${promotion_verified_json}"
    if assert_promoted "${promotion_verified_json}" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  printf 'promotion_reconciliation=TIMEOUT\n' >&2
  return 1
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
      --form "image=@test-assets/service_notice.png;type=image/png" \
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
if "cache-control: no-store" not in Path(headers_path).read_text().lower():
    raise SystemExit("Production negative v2 smoke is cacheable")
body = json.loads(Path(body_path).read_text())
if body.get("error", {}).get("code") != expected_code:
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
  grep -qi privacy "${release_workspace}/lifesnap-production-privacy.html"
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

prepare_rollback_payload() {
  local current_json="$1"
  python3 - \
    "${current_json}" \
    "${prepromotion_service_json}" \
    "${rollback_payload_json}" \
    "${CANDIDATE_REVISION}" \
    "${EXPECTED_SOURCE_COMMIT}" \
    "${promotion_owner}" <<'PY'
import copy
import json
import sys
from pathlib import Path

current_path, initial_path, payload_path, candidate_revision, source_commit, owner = sys.argv[1:]
current = json.loads(Path(current_path).read_text())
initial = json.loads(Path(initial_path).read_text())
labels = current.get("metadata", {}).get("labels", {})
traffic = current.get("spec", {}).get("traffic", [])
owned = (
    labels.get("source-commit") == source_commit
    and labels.get("promotion-owner") == owner
    and traffic == [{"revisionName": candidate_revision, "percent": 100}]
)
if not owned:
    raise SystemExit(20)
metadata = current["metadata"]
payload = {
    "apiVersion": current["apiVersion"],
    "kind": current["kind"],
    "metadata": {
        "name": metadata["name"],
        "namespace": metadata["namespace"],
        "labels": initial.get("metadata", {}).get("labels", {}),
        "annotations": metadata.get("annotations", {}),
        "resourceVersion": metadata["resourceVersion"],
    },
    "spec": copy.deepcopy(initial["spec"]),
}
Path(payload_path).write_text(json.dumps(payload) + "\n")
PY
}

rollback_if_owned() {
  local current_json="${release_workspace}/lifesnap-promotion-rollback-current.json"
  local result=0
  set +e
  api_get_service "${current_json}" || result=$?
  if [[ "${result}" -eq 0 ]]; then
    prepare_rollback_payload "${current_json}" || result=$?
  fi
  if [[ "${result}" -eq 20 ]]; then
    printf 'promotion_rollback=SKIPPED newer_owner\n' >&2
    return 0
  fi
  if [[ "${result}" -ne 0 ]]; then
    printf 'promotion_rollback=FAILED validation\n' >&2
    return "${result}"
  fi
  conditional_replace "${rollback_payload_json}" "${rollback_response_json}" || return $?
  api_get_service "${rollback_verified_json}" || return $?
  python3 - "${rollback_verified_json}" "${prepromotion_service_json}" <<'PY'
import json
import sys
from pathlib import Path

current = json.loads(Path(sys.argv[1]).read_text())
initial = json.loads(Path(sys.argv[2]).read_text())
if current.get("metadata", {}).get("labels", {}) != initial.get("metadata", {}).get("labels", {}):
    raise SystemExit("Rollback labels were not restored")
if current.get("spec", {}).get("traffic", []) != initial.get("spec", {}).get("traffic", []):
    raise SystemExit("Rollback traffic was not restored")
PY
  printf 'promotion_rollback=PASS revision=%s\n' "${rollback_revision}" >&2
}

on_exit() {
  local exit_code="$1"
  trap - ERR INT TERM EXIT
  if [[ "${exit_code}" -ne 0 && "${promotion_mutation_started}" -eq 1 ]]; then
    rollback_if_owned || true
  fi
  exit "${exit_code}"
}

validate_device_evidence
access_token="$(gcloud auth print-access-token)"
capture_and_validate_candidate
prepare_promotion_payload
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'on_exit $?' EXIT
promotion_mutation_started=1
conditional_replace "${promotion_payload_json}" "${promotion_response_json}"
wait_for_promotion
verify_production_endpoints
promotion_mutation_started=0
printf 'promotion_result=PASS revision=%s\n' "${CANDIDATE_REVISION}"
printf 'promotion_rollback_revision=%s\n' "${rollback_revision}"
