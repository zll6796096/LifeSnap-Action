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
candidate_tag="candidate-${SHORT_SHA}"
candidate_revision="$(
  tr -d '\n' < "${release_workspace}/lifesnap-candidate-revision.txt"
)"
rollback_revision="$(
  tr -d '\n' < "${release_workspace}/lifesnap-rollback-revision.txt"
)"
rollback_image="$(
  tr -d '\n' < "${release_workspace}/lifesnap-rollback-image.txt"
)"
rollback_source_commit="$(
  tr -d '\n' < "${release_workspace}/lifesnap-rollback-source-commit.txt"
)"

describe_service() {
  local destination="$1"
  gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${DEPLOY_REGION}" \
    --format=json > "${destination}"
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

assert_release_marker() {
  local service_json="${release_workspace}/lifesnap-service-prepromotion.json"
  describe_service "${service_json}"
  python3 - \
    "${service_json}" \
    "${BUILD_ID}" \
    "${COMMIT_SHA}" \
    "${candidate_tag}" \
    "${candidate_revision}" \
    "${rollback_revision}" <<'PY'
import json
import sys
from pathlib import Path

path, build_id, commit_sha, candidate_tag, candidate_revision, rollback_revision = (
    sys.argv[1:]
)
service = json.loads(Path(path).read_text())
labels = service["metadata"].get("labels", {})
if labels.get("release-build") != build_id:
    raise SystemExit("A newer overlapping build owns the service release marker")
if labels.get("source-commit") != commit_sha:
    raise SystemExit("Service source provenance does not match this build")

candidate = [
    item
    for item in service["status"]["traffic"]
    if item.get("tag") == candidate_tag
]
if (
    len(candidate) != 1
    or candidate[0].get("revisionName") != candidate_revision
    or candidate[0].get("percent", 0) != 0
):
    raise SystemExit("Unique candidate tag no longer points to this zero-traffic revision")

production = [
    item
    for item in service["status"]["traffic"]
    if item.get("percent", 0) == 100
]
if len(production) != 1 or production[0].get("revisionName") != rollback_revision:
    raise SystemExit("Production traffic changed before promotion")
PY
}

traffic_revision() {
  local service_json="$1"
  python3 - "${service_json}" <<'PY'
import json
import sys
from pathlib import Path

service = json.loads(Path(sys.argv[1]).read_text())
receiving = [
    item.get("revisionName")
    for item in service["status"]["traffic"]
    if item.get("percent", 0) == 100 and item.get("revisionName")
]
print(receiving[0] if len(receiving) == 1 else "")
PY
}

release_marker() {
  local service_json="$1"
  python3 - "${service_json}" <<'PY'
import json
import sys
from pathlib import Path

service = json.loads(Path(sys.argv[1]).read_text())
print(service["metadata"].get("labels", {}).get("release-build", ""))
PY
}

restore_rollback_provenance() {
  gcloud run services update "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${DEPLOY_REGION}" \
    --platform=managed \
    --image="${rollback_image}" \
    --no-traffic \
    --update-labels="source-commit=${rollback_source_commit},managed-by=cloud-build,product=lifesnap-action,environment=production" \
    --remove-labels=release-build,commit-sha,gcb-build-id,gcb-trigger-id,gcb-trigger-region \
    --quiet
}

rollback_on_error() {
  local exit_code=$?
  local trap_service_json="${release_workspace}/lifesnap-service-trap.json"
  local current_revision=""
  local marker=""

  trap - ERR
  set +e
  describe_service "${trap_service_json}"
  current_revision="$(traffic_revision "${trap_service_json}")"

  if [[ "${current_revision}" == "${candidate_revision}" ]]; then
    gcloud run services update-traffic "${SERVICE_NAME}" \
      --project="${PROJECT_ID}" \
      --region="${DEPLOY_REGION}" \
      --platform=managed \
      --to-revisions="${rollback_revision}=100" \
      --quiet
  fi

  gcloud run services update-traffic "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${DEPLOY_REGION}" \
    --platform=managed \
    --remove-tags="${candidate_tag},candidate" \
    --quiet

  describe_service "${trap_service_json}"
  current_revision="$(traffic_revision "${trap_service_json}")"
  marker="$(release_marker "${trap_service_json}")"
  if [[
    "${current_revision}" == "${rollback_revision}" &&
      "${marker}" == "${BUILD_ID}"
  ]]; then
    restore_rollback_provenance
  fi

  describe_service "${trap_service_json}"
  current_revision="$(traffic_revision "${trap_service_json}")"
  if [[ "${current_revision}" == "${candidate_revision}" ]]; then
    printf 'rollback_failed candidate_revision_still_receives_traffic=%s\n' \
      "${candidate_revision}" >&2
  else
    printf 'rollback_result=PASS production_revision=%s\n' \
      "${current_revision}" >&2
  fi
  exit "${exit_code}"
}

assert_promoted_service() {
  local service_json="$1"
  local require_tag="$2"
  python3 - \
    "${service_json}" \
    "${BUILD_ID}" \
    "${COMMIT_SHA}" \
    "${candidate_tag}" \
    "${candidate_revision}" \
    "${require_tag}" <<'PY'
import json
import sys
from pathlib import Path

path, build_id, commit_sha, candidate_tag, candidate_revision, require_tag = (
    sys.argv[1:]
)
service = json.loads(Path(path).read_text())
labels = service["metadata"].get("labels", {})
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

traffic = service["status"]["traffic"]
receiving = [
    item
    for item in traffic
    if item.get("revisionName") == candidate_revision
    and item.get("percent", 0) == 100
]
if len(receiving) != 1 or sum(item.get("percent", 0) for item in traffic) != 100:
    raise SystemExit("Verified candidate does not exclusively receive production traffic")

tagged = [item for item in traffic if item.get("tag") == candidate_tag]
temporary_tags = [
    item
    for item in traffic
    if item.get("tag") in {candidate_tag, "candidate"}
]
if require_tag == "yes" and len(tagged) != 1:
    raise SystemExit("Candidate tag disappeared before post-promotion checks")
if require_tag == "no" and temporary_tags:
    raise SystemExit("Temporary candidate tag remains after successful verification")
PY
}

trap rollback_on_error ERR
assert_current_main
assert_release_marker

gcloud run services update-traffic "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${DEPLOY_REGION}" \
  --platform=managed \
  --to-revisions="${candidate_revision}=100" \
  --quiet

describe_service "${release_workspace}/lifesnap-service-promoted.json"
service_url="$(
  python3 - "${release_workspace}/lifesnap-service-promoted.json" <<'PY'
import json
import sys
from pathlib import Path

print(json.loads(Path(sys.argv[1]).read_text())["status"]["url"])
PY
)"
assert_promoted_service \
  "${release_workspace}/lifesnap-service-promoted.json" \
  yes

curl --fail --silent --show-error \
  --retry 3 --retry-all-errors --retry-delay 5 \
  --output "${release_workspace}/lifesnap-production-health.json" \
  "${service_url}/health"
curl --fail --silent --show-error \
  --retry 3 --retry-all-errors --retry-delay 5 \
  --output "${release_workspace}/lifesnap-production-privacy.html" \
  "${service_url}/privacy"
grep -qi privacy "${release_workspace}/lifesnap-production-privacy.html"
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
PY

assert_current_main
describe_service "${release_workspace}/lifesnap-service-postchecks.json"
assert_promoted_service \
  "${release_workspace}/lifesnap-service-postchecks.json" \
  yes

gcloud run services update-traffic "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${DEPLOY_REGION}" \
  --platform=managed \
  --remove-tags="${candidate_tag},candidate" \
  --quiet

describe_service "${release_workspace}/lifesnap-service-final.json"
assert_promoted_service \
  "${release_workspace}/lifesnap-service-final.json" \
  no
trap - ERR

printf 'promotion_result=PASS\n'
printf 'source_commit=%s\n' "${COMMIT_SHA}"
printf 'production_revision=%s\n' "${candidate_revision}"
printf 'rollback_revision=%s\n' "${rollback_revision}"
printf 'service_url=%s\n' "${service_url}"
