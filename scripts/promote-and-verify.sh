#!/usr/bin/env bash
set -Eeuo pipefail

: "${BUILD_ID:?BUILD_ID is required}"
: "${COMMIT_SHA:?COMMIT_SHA is required}"
: "${DEPLOY_REGION:?DEPLOY_REGION is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${SERVICE_NAME:?SERVICE_NAME is required}"
: "${SHORT_SHA:?SHORT_SHA is required}"

release_workspace="${RELEASE_WORKSPACE:-/workspace}"
repository_url="${REPOSITORY_URL:-https://github.com/zll6796096/LifeSnap-Action.git}"
build_token="${BUILD_ID%%-*}"
candidate_tag="candidate-${SHORT_SHA}-${build_token}"
service_api="https://${DEPLOY_REGION}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${PROJECT_ID}/services/${SERVICE_NAME}"
initial_service_json="${release_workspace}/lifesnap-service-initial.json"
candidate_service_json="${release_workspace}/lifesnap-service-candidate.json"
prepromotion_service_json="${release_workspace}/lifesnap-service-prepromotion.json"
promoted_service_json="${release_workspace}/lifesnap-service-promoted.json"
final_service_json="${release_workspace}/lifesnap-service-final.json"
image_digest="$(
  tr -d '\n' < "${release_workspace}/lifesnap-image-digest.txt"
)"
candidate_revision=""
candidate_url=""
rollback_revision=""
runtime_service_account=""
access_token=""
candidate_mutation_started=0
release_error=0

if [[ ! "${image_digest}" =~ @sha256:[0-9a-f]{64}$ ]]; then
  printf 'invalid_immutable_image=%s\n' "${image_digest}" >&2
  exit 1
fi
if [[ ! "${candidate_tag}" =~ ^[a-z0-9-]{1,63}$ ]]; then
  printf 'invalid_candidate_tag=%s\n' "${candidate_tag}" >&2
  exit 1
fi

record_error() {
  release_error=1
}

install_release_traps() {
  trap 'record_error' ERR
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'on_exit $?' EXIT
}

on_exit() {
  local exit_code="$1"
  local cleanup_code=0

  trap - ERR INT TERM EXIT
  if [[ "${exit_code}" -ne 0 && "${candidate_mutation_started}" -eq 1 ]]; then
    set +e
    cleanup_failed_release
    cleanup_code=$?
    if [[ "${cleanup_code}" -ne 0 ]]; then
      printf 'cleanup_result=FAILED original_exit=%s cleanup_exit=%s\n' \
        "${exit_code}" "${cleanup_code}" >&2
    fi
  fi
  exit "${exit_code}"
}

api_get_url() {
  local url="$1"
  local destination="$2"
  curl --fail --silent --show-error \
    --header "Authorization: Bearer ${access_token}" \
    --output "${destination}" \
    "${url}"
}

api_get_service() {
  local destination="$1"
  api_get_url "${service_api}" "${destination}"
}

replacement_matches() {
  local current_json="$1"
  local payload="$2"
  python3 - "${current_json}" "${payload}" <<'PY'
import json
import sys
from pathlib import Path

current = json.loads(Path(sys.argv[1]).read_text())
desired = json.loads(Path(sys.argv[2]).read_text())
conditions = current.get("status", {}).get("conditions", [])
ready = any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in conditions
)
desired_traffic = desired.get("spec", {}).get("traffic", [])
status_traffic = [
    {
        key: item[key]
        for key in ("revisionName", "percent", "tag")
        if key in item
    }
    for item in current.get("status", {}).get("traffic", [])
]
matches = (
    current.get("metadata", {}).get("labels", {})
    == desired.get("metadata", {}).get("labels", {})
    and current.get("spec", {}).get("traffic", []) == desired_traffic
    and status_traffic == desired_traffic
    and ready
)
print("yes" if matches else "no")
PY
}

wait_for_replacement() {
  local payload="$1"
  local current_json="$2"
  local attempt

  for ((attempt = 1; attempt <= 90; attempt += 1)); do
    if ! api_get_service "${current_json}"; then
      return 1
    fi
    if [[ "$(replacement_matches "${current_json}" "${payload}")" == yes ]]; then
      return 0
    fi
    sleep 2
  done
  printf 'cloud_run_replacement=timeout\n' >&2
  return 1
}

conditional_replace() {
  local payload="$1"
  local response_json="$2"
  local verified_json="$3"

  if ! curl --fail --silent --show-error \
    --request PUT \
    --header "Authorization: Bearer ${access_token}" \
    --header "Content-Type: application/json" \
    --data-binary "@${payload}" \
    --output "${response_json}" \
    "${service_api}"; then
    return 1
  fi
  wait_for_replacement "${payload}" "${verified_json}"
}

remote_main_sha() {
  git ls-remote --exit-code "${repository_url}" refs/heads/main |
    awk 'NR == 1 {print $1}'
}

assert_current_main() {
  local remote_sha
  remote_sha="$(remote_main_sha)"
  if [[ "${remote_sha}" != "${COMMIT_SHA}" ]]; then
    printf 'stale_build=BLOCKED expected=%s actual=%s\n' \
      "${COMMIT_SHA}" "${remote_sha}" >&2
    return 1
  fi
}

capture_initial_state() {
  api_get_service "${initial_service_json}"
  read -r rollback_revision runtime_service_account < <(
    python3 - "${initial_service_json}" <<'PY'
import json
import sys
from pathlib import Path

service = json.loads(Path(sys.argv[1]).read_text())
metadata = service.get("metadata", {})
if not metadata.get("resourceVersion"):
    raise SystemExit("Cloud Run service resourceVersion is missing")
conditions = service.get("status", {}).get("conditions", [])
if not any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in conditions
):
    raise SystemExit("Cloud Run service is not ready before candidate deployment")
traffic = service.get("spec", {}).get("traffic", [])
production = [
    item
    for item in traffic
    if item.get("percent", 0) == 100 and item.get("revisionName")
]
if len(production) != 1 or sum(item.get("percent", 0) for item in traffic) != 100:
    raise SystemExit("Expected one exclusive production revision")
labels = metadata.get("labels", {})
source_commit = labels.get("source-commit", "")
if len(source_commit) != 40:
    raise SystemExit("Initial production source provenance is missing")
runtime_service_account = (
    service.get("spec", {})
    .get("template", {})
    .get("spec", {})
    .get("serviceAccountName", "")
)
if not runtime_service_account:
    raise SystemExit("Initial runtime service account is missing")
print(production[0]["revisionName"], runtime_service_account)
PY
  )
}

prepare_candidate_payload() {
  local payload="$1"
  python3 - \
    "${initial_service_json}" \
    "${payload}" \
    "${BUILD_ID}" \
    "${COMMIT_SHA}" \
    "${candidate_tag}" \
    "${image_digest}" <<'PY'
import copy
import json
import sys
from pathlib import Path

(
    initial_path,
    payload_path,
    build_id,
    commit_sha,
    candidate_tag,
    image_digest,
) = sys.argv[1:]
current = json.loads(Path(initial_path).read_text())
metadata = current.get("metadata", {})
resource_version = metadata.get("resourceVersion")
if not resource_version:
    raise SystemExit("Candidate service resourceVersion is missing")
spec = copy.deepcopy(current.get("spec", {}))
template = spec.get("template", {})
template_metadata = template.get("metadata", {})
template_labels = dict(template_metadata.get("labels", {}))
for key in (
    "commit-sha",
    "gcb-build-id",
    "gcb-trigger-id",
    "gcb-trigger-region",
):
    template_labels.pop(key, None)
template_labels.update(
    {
        "source-commit": commit_sha,
        "managed-by": "cloud-build",
        "product": "lifesnap-action",
        "environment": "production",
        "release-build": build_id,
    }
)
template["metadata"] = {
    "labels": template_labels,
    "annotations": template_metadata.get("annotations", {}),
}
containers = template.get("spec", {}).get("containers", [])
if len(containers) != 1:
    raise SystemExit("Expected one service container for candidate")
containers[0]["image"] = image_digest
traffic = copy.deepcopy(current.get("spec", {}).get("traffic", []))
if any(item.get("tag") == candidate_tag for item in traffic):
    raise SystemExit("Unique candidate tag already exists")
traffic.append(
    {
        "latestRevision": True,
        "percent": 0,
        "tag": candidate_tag,
    }
)
spec["template"] = template
spec["traffic"] = traffic
payload = {
    "apiVersion": current["apiVersion"],
    "kind": current["kind"],
    "metadata": {
        "name": metadata["name"],
        "namespace": metadata["namespace"],
        "labels": metadata.get("labels", {}),
        "annotations": metadata.get("annotations", {}),
        "resourceVersion": resource_version,
    },
    "spec": spec,
}
Path(payload_path).write_text(json.dumps(payload) + "\n")
PY
}

conditional_replace_candidate() {
  local payload="$1"
  local response_json="$2"

  curl --fail --silent --show-error \
    --request PUT \
    --header "Authorization: Bearer ${access_token}" \
    --header "Content-Type: application/json" \
    --data-binary "@${payload}" \
    --output "${response_json}" \
    "${service_api}"
}

deploy_candidate() {
  local payload="${release_workspace}/lifesnap-candidate-payload.json"
  local response="${release_workspace}/lifesnap-candidate-response.json"

  prepare_candidate_payload "${payload}"
  candidate_mutation_started=1
  conditional_replace_candidate "${payload}" "${response}"
}

resolve_candidate() {
  local attempt
  local resolution=""
  local resolution_code=0

  for ((attempt = 1; attempt <= 90; attempt += 1)); do
    api_get_service "${candidate_service_json}"
    if resolution="$(
      python3 - \
        "${candidate_service_json}" \
        "${initial_service_json}" \
        "${candidate_tag}" \
        "${rollback_revision}" <<'PY'
import json
import sys
from pathlib import Path

current_path, initial_path, candidate_tag, rollback_revision = sys.argv[1:]
current = json.loads(Path(current_path).read_text())
initial = json.loads(Path(initial_path).read_text())
if (
    current.get("metadata", {}).get("labels", {})
    != initial.get("metadata", {}).get("labels", {})
):
    raise SystemExit("Candidate deployment changed service provenance labels")
current_version = current.get("metadata", {}).get("resourceVersion")
initial_version = initial.get("metadata", {}).get("resourceVersion")
if not current_version:
    raise SystemExit("Candidate service resourceVersion is missing")
if current_version == initial_version:
    raise SystemExit(10)
candidate = [
    item
    for item in current.get("status", {}).get("traffic", [])
    if item.get("tag") == candidate_tag
]
if not candidate:
    raise SystemExit(10)
if (
    len(candidate) != 1
    or not candidate[0].get("revisionName")
    or not candidate[0].get("url")
    or candidate[0].get("percent", 0) != 0
):
    raise SystemExit("Unique zero-traffic candidate target is missing")
traffic = current.get("spec", {}).get("traffic", [])
candidate_spec = [
    item
    for item in traffic
    if item.get("tag") == candidate_tag
]
if (
    len(candidate_spec) != 1
    or candidate_spec[0].get("percent", 0) != 0
    or not (
        candidate_spec[0].get("latestRevision") is True
        or candidate_spec[0].get("revisionName")
        == candidate[0].get("revisionName")
    )
):
    raise SystemExit("Candidate spec target does not resolve to the new revision")
production = [
    item
    for item in traffic
    if item.get("percent", 0) == 100 and item.get("revisionName")
]
if len(production) != 1 or production[0]["revisionName"] != rollback_revision:
    raise SystemExit("Production traffic changed during candidate deployment")
without_candidate = [
    item
    for item in traffic
    if item.get("tag") != candidate_tag
]
if without_candidate != initial.get("spec", {}).get("traffic", []):
    raise SystemExit("Another service traffic mutation overlaps this candidate")
conditions = current.get("status", {}).get("conditions", [])
ready = [
    item
    for item in conditions
    if item.get("type") == "Ready"
]
if any(item.get("status") == "False" for item in ready):
    raise SystemExit("Candidate service reconciliation failed")
if not any(item.get("status") == "True" for item in ready):
    raise SystemExit(10)
print(candidate[0]["revisionName"], candidate[0]["url"])
PY
    )"; then
      read -r candidate_revision candidate_url <<< "${resolution}"
      break
    else
      resolution_code=$?
      if [[ "${resolution_code}" -ne 10 ]]; then
        return "${resolution_code}"
      fi
    fi
    sleep 2
  done
  if [[ -z "${candidate_revision}" || -z "${candidate_url}" ]]; then
    printf 'candidate_resolution=timeout\n' >&2
    return 1
  fi
  printf '%s\n' "${candidate_revision}" \
    > "${release_workspace}/lifesnap-candidate-revision.txt"
  printf '%s\n' "${candidate_url}" \
    > "${release_workspace}/lifesnap-candidate-url.txt"
}

verify_candidate_runtime() {
  local revision_json="${release_workspace}/lifesnap-candidate-revision.json"
  gcloud run revisions describe "${candidate_revision}" \
    --project="${PROJECT_ID}" \
    --region="${DEPLOY_REGION}" \
    --format=json > "${revision_json}"
  python3 - \
    "${revision_json}" \
    "${image_digest}" \
    "${runtime_service_account}" \
    "${BUILD_ID}" \
    "${COMMIT_SHA}" <<'PY'
import json
import sys
from pathlib import Path

(
    path,
    expected_image_digest,
    expected_service_account,
    build_id,
    commit_sha,
) = sys.argv[1:]
revision = json.loads(Path(path).read_text())
if revision.get("status", {}).get("imageDigest") != expected_image_digest:
    raise SystemExit("Candidate revision digest does not match pushed image")
labels = revision.get("metadata", {}).get("labels", {})
expected_labels = {
    "source-commit": commit_sha,
    "release-build": build_id,
    "managed-by": "cloud-build",
    "product": "lifesnap-action",
    "environment": "production",
}
for key, value in expected_labels.items():
    if labels.get(key) != value:
        raise SystemExit(f"Candidate revision label mismatch: {key}")
for key in (
    "commit-sha",
    "gcb-build-id",
    "gcb-trigger-id",
    "gcb-trigger-region",
):
    if key in labels:
        raise SystemExit(f"Legacy candidate revision label remains: {key}")
if revision.get("spec", {}).get("serviceAccountName") != expected_service_account:
    raise SystemExit("Candidate runtime service account changed")
containers = revision.get("spec", {}).get("containers", [])
if len(containers) != 1:
    raise SystemExit("Expected one candidate container")
env = {item["name"]: item for item in containers[0].get("env", [])}
if env.get("MOCK_MODE", {}).get("value") != "false":
    raise SystemExit("Candidate must run with MOCK_MODE=false")
secret_ref = (
    env.get("GEMINI_API_KEY", {})
    .get("valueFrom", {})
    .get("secretKeyRef", {})
)
if not secret_ref.get("name"):
    raise SystemExit("Gemini key is not injected from Secret Manager")
print("candidate_runtime=PASS")
PY
}

verify_candidate_endpoints() {
  curl --fail --silent --show-error \
    --retry 6 --retry-all-errors --retry-delay 5 \
    --output "${release_workspace}/lifesnap-candidate-health.json" \
    "${candidate_url}/health"
  curl --fail --silent --show-error \
    --retry 6 --retry-all-errors --retry-delay 5 \
    --output "${release_workspace}/lifesnap-candidate-privacy.html" \
    "${candidate_url}/privacy"
  grep -qi privacy \
    "${release_workspace}/lifesnap-candidate-privacy.html"
  curl --fail --silent --show-error \
    --retry 2 --retry-all-errors --retry-delay 5 --max-time 120 \
    --form "image=@test-assets/service_notice.png;type=image/png" \
    --output "${release_workspace}/lifesnap-candidate-extract.json" \
    "${candidate_url}/api/extract"
  python3 - "${release_workspace}" <<'PY'
import json
import sys
from pathlib import Path

workspace = Path(sys.argv[1])
health = json.loads((workspace / "lifesnap-candidate-health.json").read_text())
extract = json.loads((workspace / "lifesnap-candidate-extract.json").read_text())
if health.get("status") != "ok":
    raise SystemExit("Candidate health response is not ok")
required = {"title", "summary", "route", "confidence", "evidence", "risk_flags"}
if not isinstance(extract, dict) or not required.issubset(extract):
    raise SystemExit("Candidate extraction response is incomplete")
print(f"candidate_smoke=PASS route={extract['route']}")
PY
}

prepare_promotion_payload() {
  local payload="$1"
  python3 - \
    "${prepromotion_service_json}" \
    "${initial_service_json}" \
    "${payload}" \
    "${BUILD_ID}" \
    "${COMMIT_SHA}" \
    "${candidate_tag}" \
    "${candidate_revision}" \
    "${rollback_revision}" <<'PY'
import copy
import json
import sys
from pathlib import Path

(
    current_path,
    initial_path,
    payload_path,
    build_id,
    commit_sha,
    candidate_tag,
    candidate_revision,
    rollback_revision,
) = sys.argv[1:]
current = json.loads(Path(current_path).read_text())
initial = json.loads(Path(initial_path).read_text())
metadata = current.get("metadata", {})
initial_metadata = initial.get("metadata", {})
if not metadata.get("resourceVersion"):
    raise SystemExit("Pre-promotion service resourceVersion is missing")
if metadata.get("labels", {}) != initial_metadata.get("labels", {}):
    raise SystemExit("Service provenance changed before promotion")
traffic = current.get("spec", {}).get("traffic", [])
candidate = [
    item
    for item in traffic
    if item.get("tag") == candidate_tag
]
if (
    len(candidate) != 1
    or candidate[0].get("percent", 0) != 0
    or not (
        candidate[0].get("latestRevision") is True
        or candidate[0].get("revisionName") == candidate_revision
    )
):
    raise SystemExit("Candidate target changed before promotion")
status_candidate = [
    item
    for item in current.get("status", {}).get("traffic", [])
    if item.get("tag") == candidate_tag
]
if (
    len(status_candidate) != 1
    or status_candidate[0].get("revisionName") != candidate_revision
    or status_candidate[0].get("percent", 0) != 0
):
    raise SystemExit("Candidate status target changed before promotion")
production = [
    item
    for item in traffic
    if item.get("percent", 0) == 100 and item.get("revisionName")
]
if len(production) != 1 or production[0]["revisionName"] != rollback_revision:
    raise SystemExit("Production traffic changed before promotion")
without_candidate = [
    item
    for item in traffic
    if item.get("tag") != candidate_tag
]
if without_candidate != initial.get("spec", {}).get("traffic", []):
    raise SystemExit("Another service traffic mutation overlaps promotion")
labels = dict(metadata.get("labels", {}))
for key in (
    "commit-sha",
    "gcb-build-id",
    "gcb-trigger-id",
    "gcb-trigger-region",
):
    labels.pop(key, None)
labels.update(
    {
        "source-commit": commit_sha,
        "managed-by": "cloud-build",
        "product": "lifesnap-action",
        "environment": "production",
        "release-build": build_id,
    }
)
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

conditionally_promote_candidate() {
  local payload="${release_workspace}/lifesnap-promotion-payload.json"
  local response="${release_workspace}/lifesnap-promotion-response.json"
  local verified="${release_workspace}/lifesnap-promotion-verified.json"

  api_get_service "${prepromotion_service_json}"
  prepare_promotion_payload "${payload}"
  assert_current_main
  conditional_replace "${payload}" "${response}" "${verified}"
}

assert_promoted_service() {
  local service_json="$1"
  python3 - \
    "${service_json}" \
    "${BUILD_ID}" \
    "${COMMIT_SHA}" \
    "${candidate_revision}" \
    "${image_digest}" <<'PY'
import json
import sys
from pathlib import Path

path, build_id, commit_sha, candidate_revision, image_digest = sys.argv[1:]
service = json.loads(Path(path).read_text())
labels = service.get("metadata", {}).get("labels", {})
expected = {
    "source-commit": commit_sha,
    "managed-by": "cloud-build",
    "product": "lifesnap-action",
    "environment": "production",
    "release-build": build_id,
}
for key, value in expected.items():
    if labels.get(key) != value:
        raise SystemExit(f"Promoted service label mismatch: {key}")
for key in (
    "commit-sha",
    "gcb-build-id",
    "gcb-trigger-id",
    "gcb-trigger-region",
):
    if key in labels:
        raise SystemExit(f"Legacy provenance label remains: {key}")
template = service.get("spec", {}).get("template", {})
template_labels = template.get("metadata", {}).get("labels", {})
for key, value in expected.items():
    if template_labels.get(key) != value:
        raise SystemExit(f"Promoted template label mismatch: {key}")
containers = template.get("spec", {}).get("containers", [])
if (
    len(containers) != 1
    or containers[0].get("image") != image_digest
):
    raise SystemExit("Promoted template digest does not match pushed image")
traffic = service.get("spec", {}).get("traffic", [])
if traffic != [
    {
        "revisionName": candidate_revision,
        "percent": 100,
    }
]:
    raise SystemExit("Verified candidate does not exclusively receive traffic")
conditions = service.get("status", {}).get("conditions", [])
if not any(
    item.get("type") == "Ready" and item.get("status") == "True"
    for item in conditions
):
    raise SystemExit("Promoted service is not ready")
service_url = service.get("status", {}).get("url")
if not service_url:
    raise SystemExit("Promoted service URL is missing")
print(service_url)
PY
}

verify_production_endpoints() {
  local service_url="$1"
  curl --fail --silent --show-error \
    --retry 3 --retry-all-errors --retry-delay 5 \
    --output "${release_workspace}/lifesnap-production-health.json" \
    "${service_url}/health"
  curl --fail --silent --show-error \
    --retry 3 --retry-all-errors --retry-delay 5 \
    --output "${release_workspace}/lifesnap-production-privacy.html" \
    "${service_url}/privacy"
  grep -qi privacy \
    "${release_workspace}/lifesnap-production-privacy.html"
  curl --fail --silent --show-error \
    --retry 2 --retry-all-errors --retry-delay 5 --max-time 120 \
    --form "image=@test-assets/service_notice.png;type=image/png" \
    --output "${release_workspace}/lifesnap-production-extract.json" \
    "${service_url}/api/extract"
  python3 - "${release_workspace}" <<'PY'
import json
import sys
from pathlib import Path

workspace = Path(sys.argv[1])
health = json.loads((workspace / "lifesnap-production-health.json").read_text())
extract = json.loads((workspace / "lifesnap-production-extract.json").read_text())
if health.get("status") != "ok":
    raise SystemExit("Production health response is not ok")
required = {"title", "summary", "route", "confidence", "evidence", "risk_flags"}
if not isinstance(extract, dict) or not required.issubset(extract):
    raise SystemExit("Production extraction response is incomplete")
print(f"production_smoke=PASS route={extract['route']}")
PY
}

cleanup_mode() {
  local current_json="$1"
  python3 - \
    "${current_json}" \
    "${initial_service_json}" \
    "${BUILD_ID}" \
    "${COMMIT_SHA}" \
    "${candidate_tag}" \
    "${candidate_revision}" <<'PY'
import json
import sys
from pathlib import Path

current_path, initial_path, build_id, commit_sha, candidate_tag, candidate_revision = (
    sys.argv[1:]
)
current = json.loads(Path(current_path).read_text())
initial = json.loads(Path(initial_path).read_text())
labels = current.get("metadata", {}).get("labels", {})
traffic = current.get("spec", {}).get("traffic", [])
candidate_targets = [
    item for item in traffic if item.get("tag") == candidate_tag
]
production = [
    item
    for item in traffic
    if item.get("percent", 0) == 100 and item.get("revisionName")
]
owned_labels = (
    labels.get("release-build") == build_id
    and labels.get("source-commit") == commit_sha
    and labels.get("managed-by") == "cloud-build"
    and labels.get("product") == "lifesnap-action"
    and labels.get("environment") == "production"
)
owned_promotion = (
    owned_labels
    and candidate_revision
    and len(production) == 1
    and production[0]["revisionName"] == candidate_revision
)
owned_candidate_provenance = (
    labels == initial.get("metadata", {}).get("labels", {})
    or owned_labels
)
owned_candidate = (
    owned_candidate_provenance
    and len(candidate_targets) == 1
)
if owned_promotion:
    print("restore")
elif owned_candidate:
    print("restore")
elif candidate_targets:
    print("remove-tag")
else:
    print("none")
PY
}

prepare_restore_payload() {
  local current_json="$1"
  local payload="$2"
  python3 - \
    "${current_json}" \
    "${initial_service_json}" \
    "${payload}" <<'PY'
import json
import sys
from pathlib import Path

current_path, initial_path, payload_path = sys.argv[1:]
current = json.loads(Path(current_path).read_text())
initial = json.loads(Path(initial_path).read_text())
metadata = current["metadata"]
spec = current["spec"]
spec["traffic"] = initial.get("spec", {}).get("traffic", [])
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
    "spec": spec,
}
Path(payload_path).write_text(json.dumps(payload) + "\n")
PY
}

prepare_tag_cleanup_payload() {
  local current_json="$1"
  local payload="$2"
  python3 - \
    "${current_json}" \
    "${payload}" \
    "${candidate_tag}" <<'PY'
import json
import sys
from pathlib import Path

current_path, payload_path, candidate_tag = sys.argv[1:]
current = json.loads(Path(current_path).read_text())
metadata = current["metadata"]
traffic = []
for target in current.get("spec", {}).get("traffic", []):
    if target.get("tag") != candidate_tag:
        traffic.append(target)
        continue
    if target.get("percent", 0) > 0:
        untagged = dict(target)
        untagged.pop("tag", None)
        traffic.append(untagged)
spec = current["spec"]
spec["traffic"] = traffic
payload = {
    "apiVersion": current["apiVersion"],
    "kind": current["kind"],
    "metadata": {
        "name": metadata["name"],
        "namespace": metadata["namespace"],
        "labels": metadata.get("labels", {}),
        "annotations": metadata.get("annotations", {}),
        "resourceVersion": metadata["resourceVersion"],
    },
    "spec": spec,
}
Path(payload_path).write_text(json.dumps(payload) + "\n")
PY
}

verify_cleanup() {
  local mode="$1"
  local current_json="$2"
  python3 - \
    "${mode}" \
    "${current_json}" \
    "${initial_service_json}" \
    "${candidate_tag}" <<'PY'
import json
import sys
from pathlib import Path

mode, current_path, initial_path, candidate_tag = sys.argv[1:]
current = json.loads(Path(current_path).read_text())
initial = json.loads(Path(initial_path).read_text())
current_traffic = current.get("spec", {}).get("traffic", [])
if any(item.get("tag") == candidate_tag for item in current_traffic):
    raise SystemExit("Unique candidate tag remains after cleanup")
if mode == "restore":
    if (
        current.get("metadata", {}).get("labels", {})
        != initial.get("metadata", {}).get("labels", {})
    ):
        raise SystemExit("Rollback provenance was not restored")
    if current_traffic != initial.get("spec", {}).get("traffic", []):
        raise SystemExit("Rollback traffic was not restored")
PY
}

cleanup_failed_release() {
  local current_json="${release_workspace}/lifesnap-service-cleanup-current.json"
  local verified_json="${release_workspace}/lifesnap-service-cleanup-verified.json"
  local payload="${release_workspace}/lifesnap-cleanup-payload.json"
  local response="${release_workspace}/lifesnap-cleanup-response.json"
  local reconciled="${release_workspace}/lifesnap-cleanup-reconciled.json"
  local mode=""

  if [[ ! -s "${initial_service_json}" || -z "${access_token}" ]]; then
    printf 'cleanup_result=SKIPPED missing_initial_state\n' >&2
    return 1
  fi
  if ! api_get_service "${current_json}"; then
    printf 'cleanup_result=FAILED service_read\n' >&2
    return 1
  fi
  mode="$(cleanup_mode "${current_json}")"
  case "${mode}" in
    restore)
      prepare_restore_payload "${current_json}" "${payload}"
      if ! conditional_replace \
        "${payload}" "${response}" "${reconciled}"; then
        printf 'cleanup_result=CONFLICT mode=restore\n' >&2
        return 1
      fi
      ;;
    remove-tag)
      prepare_tag_cleanup_payload "${current_json}" "${payload}"
      if ! conditional_replace \
        "${payload}" "${response}" "${reconciled}"; then
        printf 'cleanup_result=CONFLICT mode=remove-tag\n' >&2
        return 1
      fi
      ;;
    none)
      printf 'cleanup_result=SKIPPED newer_owner_or_no_candidate\n' >&2
      return 0
      ;;
    *)
      printf 'cleanup_result=FAILED invalid_mode\n' >&2
      return 1
      ;;
  esac
  if ! api_get_service "${verified_json}"; then
    return 1
  fi
  if ! verify_cleanup "${mode}" "${verified_json}"; then
    return 1
  fi
  printf 'cleanup_result=PASS mode=%s\n' "${mode}" >&2
}

install_release_traps
access_token="$(gcloud auth print-access-token)"
assert_current_main
capture_initial_state

deploy_candidate
resolve_candidate
verify_candidate_runtime
verify_candidate_endpoints

conditionally_promote_candidate
api_get_service "${promoted_service_json}"
service_url="$(assert_promoted_service "${promoted_service_json}")"
verify_production_endpoints "${service_url}"

assert_current_main
api_get_service "${final_service_json}"
assert_promoted_service "${final_service_json}" >/dev/null
verify_candidate_runtime

trap - ERR INT TERM EXIT
printf 'promotion_result=PASS\n'
printf 'source_commit=%s\n' "${COMMIT_SHA}"
printf 'production_revision=%s\n' "${candidate_revision}"
printf 'rollback_revision=%s\n' "${rollback_revision}"
printf 'service_url=%s\n' "${service_url}"
