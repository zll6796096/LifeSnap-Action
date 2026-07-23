import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const configPath = join(repoRoot, "cloudbuild.yaml");
const releaseScriptPath = join(repoRoot, "scripts/promote-and-verify.sh");
const temporaryDirectories: string[] = [];

type BuildStep = {
  id: string;
  args?: string[];
  env?: string[];
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("Cloud Build release contract", () => {
  it("structurally gates an immutable digest before one serialized promotion step", async () => {
    const config = parse(await readFile(configPath, "utf8")) as {
      steps: BuildStep[];
      options: { logging: string };
      serviceAccount: string;
      substitutions: Record<string, string>;
    };
    const ids = config.steps.map(({ id }) => id);

    expect(ids).toEqual([
      "npm-ci",
      "npm-test",
      "npm-lint",
      "npm-build",
      "docker-build",
      "docker-push",
      "resolve-image-digest",
      "capture-rollback",
      "deploy-candidate",
      "resolve-candidate",
      "verify-candidate-runtime",
      "verify-candidate-endpoints",
      "promote-verify-or-rollback",
    ]);
    expect(config.serviceAccount).toBe(
      "projects/zhang23-23/serviceAccounts/apps-cloud-build@zhang23-23.iam.gserviceaccount.com",
    );
    expect(config.options.logging).toBe("CLOUD_LOGGING_ONLY");
    expect(config.substitutions._LIFESNAP_AR_REPOSITORY).toBe("apps");

    const deploy = config.steps.find(({ id }) => id === "deploy-candidate");
    const candidateRuntime = config.steps.find(
      ({ id }) => id === "verify-candidate-runtime",
    );
    const promotion = config.steps.find(
      ({ id }) => id === "promote-verify-or-rollback",
    );
    expect(deploy?.args?.join("\n")).toContain(
      'candidate_tag="candidate-${SHORT_SHA}"',
    );
    expect(deploy?.args?.join("\n")).toContain(
      '--image="$${image_digest}"',
    );
    expect(deploy?.args?.join("\n")).toContain("--no-traffic");
    expect(candidateRuntime?.args?.join("\n")).toContain(
      "expected_image_digest",
    );
    expect(candidateRuntime?.args?.join("\n")).toContain(
      'revision["status"].get("imageDigest")',
    );
    expect(promotion?.args).toEqual([
      "-ceu",
      "./scripts/promote-and-verify.sh",
    ]);
    expect(promotion?.env).toEqual(
      expect.arrayContaining([
        "COMMIT_SHA=$COMMIT_SHA",
        "SHORT_SHA=$SHORT_SHA",
        "BUILD_ID=$BUILD_ID",
      ]),
    );
  });

  it("uses a stale-build guard, unique tag, rollback trap, and ordered production checks", async () => {
    const script = await readFile(releaseScriptPath, "utf8");
    const trap = script.indexOf("trap rollback_on_error ERR");
    const staleGuard = script.indexOf("\nassert_current_main\n", trap);
    const markerGuard = script.indexOf("\nassert_release_marker\n", staleGuard);
    const promote = script.indexOf("--to-revisions=", trap);
    const health = script.indexOf("/health", promote);
    const privacy = script.indexOf("/privacy", health);
    const extract = script.indexOf("/api/extract", privacy);
    const postPromotionGuard = script.indexOf("assert_current_main", extract);
    const removeTag = script.lastIndexOf("--remove-tags=");

    expect(script).toContain('candidate_tag="candidate-${SHORT_SHA}"');
    expect(script).toContain("release-build");
    expect(script).toContain("restore_rollback_provenance");
    expect(script).toContain('--remove-tags="${candidate_tag},candidate"');
    expect(script).toContain(
      'item.get("tag") in {candidate_tag, "candidate"}',
    );
    expect(trap).toBeGreaterThan(-1);
    expect(staleGuard).toBeGreaterThan(-1);
    expect(markerGuard).toBeGreaterThan(staleGuard);
    expect(staleGuard).toBeGreaterThan(trap);
    expect(promote).toBeGreaterThan(trap);
    expect(health).toBeGreaterThan(promote);
    expect(privacy).toBeGreaterThan(health);
    expect(extract).toBeGreaterThan(privacy);
    expect(postPromotionGuard).toBeGreaterThan(extract);
    expect(removeTag).toBeGreaterThan(postPromotionGuard);
  });

  it("rolls back safely when a post-promotion production check fails", async () => {
    const fixture = await createReleaseFixture({ failProductionCurl: true });
    const result = runReleaseScript(fixture);
    const calls = await readFile(fixture.gcloudLog, "utf8");
    const serviceJson = await readFile(
      join(fixture.workspace, "lifesnap-service-prepromotion.json"),
      "utf8",
    ).catch(() => "");

    expect(result.status).not.toBe(0);
    expect(calls, `${result.stderr}\nservice=${serviceJson}`).toContain(
      `--to-revisions=${fixture.candidateRevision}=100`,
    );
    expect(calls).toContain(
      `--to-revisions=${fixture.rollbackRevision}=100`,
    );
    expect(calls).toContain(`--remove-tags=${fixture.candidateTag}`);
    expect(calls).toContain("run services update");
    expect(await readFile(fixture.trafficState, "utf8")).toBe(
      "rollback-untagged\n",
    );
  });

  it("keeps the verified revision at 100% and removes its temporary tag on success", async () => {
    const fixture = await createReleaseFixture({ failProductionCurl: false });
    const result = runReleaseScript(fixture);
    const calls = await readFile(fixture.gcloudLog, "utf8");
    const serviceJson = await readFile(
      join(fixture.workspace, "lifesnap-service-prepromotion.json"),
      "utf8",
    ).catch(() => "");

    expect(result.status, `${result.stderr}\nservice=${serviceJson}`).toBe(0);
    expect(calls).toContain(
      `--to-revisions=${fixture.candidateRevision}=100`,
    );
    expect(calls).not.toContain(
      `--to-revisions=${fixture.rollbackRevision}=100`,
    );
    expect(calls).toContain(`--remove-tags=${fixture.candidateTag}`);
    expect(await readFile(fixture.trafficState, "utf8")).toBe(
      "candidate-untagged\n",
    );
  });

  it("blocks a stale main commit before promotion and cleans its candidate state", async () => {
    const fixture = await createReleaseFixture({ failProductionCurl: false });
    fixture.env.REMOTE_MAIN_SHA = "c".repeat(40);
    const result = runReleaseScript(fixture);
    const calls = await readFile(fixture.gcloudLog, "utf8");

    expect(result.status).not.toBe(0);
    expect(calls).not.toContain(
      `--to-revisions=${fixture.candidateRevision}=100`,
    );
    expect(calls).toContain(`--remove-tags=${fixture.candidateTag},candidate`);
    expect(await readFile(fixture.trafficState, "utf8")).toBe(
      "rollback-untagged\n",
    );
  });

  it("blocks an overlapping build that owns the release marker", async () => {
    const fixture = await createReleaseFixture({ failProductionCurl: false });
    fixture.env.SERVICE_RELEASE_BUILD_ID = "newer-build-456";
    const result = runReleaseScript(fixture);
    const calls = await readFile(fixture.gcloudLog, "utf8");

    expect(result.status).not.toBe(0);
    expect(calls).not.toContain(
      `--to-revisions=${fixture.candidateRevision}=100`,
    );
    expect(calls).toContain(`--remove-tags=${fixture.candidateTag},candidate`);
    expect(calls).not.toContain("run services update lifesnap-action");
    expect(await readFile(fixture.trafficState, "utf8")).toBe(
      "rollback-untagged\n",
    );
  });
});

type ReleaseFixture = {
  binDirectory: string;
  buildId: string;
  candidateRevision: string;
  candidateTag: string;
  commitSha: string;
  env: NodeJS.ProcessEnv;
  gcloudLog: string;
  rollbackRevision: string;
  trafficState: string;
  workspace: string;
};

async function createReleaseFixture({
  failProductionCurl,
}: {
  failProductionCurl: boolean;
}): Promise<ReleaseFixture> {
  const root = await mkdtemp(join(tmpdir(), "lifesnap-release-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  const binDirectory = join(root, "bin");
  const commitSha = "a".repeat(40);
  const buildId = "build-test-123";
  const candidateRevision = "lifesnap-action-00099-test";
  const rollbackRevision = "lifesnap-action-00098-safe";
  const candidateTag = "candidate-aaaaaaa";
  const trafficState = join(root, "traffic-state");
  const gcloudLog = join(root, "gcloud.log");

  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(binDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(workspace, "lifesnap-candidate-revision.txt"), `${candidateRevision}\n`),
    writeFile(join(workspace, "lifesnap-rollback-revision.txt"), `${rollbackRevision}\n`),
    writeFile(join(workspace, "lifesnap-candidate-url.txt"), "https://candidate.example\n"),
    writeFile(
      join(workspace, "lifesnap-rollback-image.txt"),
      "asia-northeast1-docker.pkg.dev/test/apps/lifesnap-action@sha256:rollback\n",
    ),
    writeFile(join(workspace, "lifesnap-rollback-source-commit.txt"), `${"b".repeat(40)}\n`),
    writeFile(trafficState, "rollback-tagged\n"),
    writeFile(gcloudLog, ""),
  ]);

  await writeExecutable(
    join(binDirectory, "git"),
    `#!/usr/bin/env bash
printf '%s\\trefs/heads/main\\n' "$REMOTE_MAIN_SHA"
`,
  );
  await writeExecutable(
    join(binDirectory, "curl"),
    `#!/usr/bin/env bash
set -eu
output=""
url=""
while (($#)); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [[ "\${FAIL_PRODUCTION_CURL:-0}" == 1 ]]; then
  exit 22
fi
case "$url" in
  */health) printf '{"status":"ok"}' > "$output" ;;
  */privacy) printf 'Privacy Policy' > "$output" ;;
  */api/extract)
    printf '{"title":"test","summary":"test","route":"calendar_action","confidence":90,"evidence":[],"risk_flags":[]}' > "$output"
    ;;
esac
`,
  );
  await writeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$GCLOUD_LOG"
args="$*"
state="$(tr -d '\\n' < "$TRAFFIC_STATE")"
if [[ "$args" == *"run services describe"* ]]; then
  case "$state" in
    rollback-tagged)
      traffic="$(printf '[{"percent":100,"revisionName":"%s"},{"revisionName":"%s","tag":"%s","url":"https://candidate.example"}]' "$ROLLBACK_REVISION" "$CANDIDATE_REVISION" "$CANDIDATE_TAG")"
      ;;
    candidate-tagged)
      traffic="$(printf '[{"percent":100,"revisionName":"%s","tag":"%s","url":"https://candidate.example"}]' "$CANDIDATE_REVISION" "$CANDIDATE_TAG")"
      ;;
    rollback-untagged)
      traffic="$(printf '[{"percent":100,"revisionName":"%s"}]' "$ROLLBACK_REVISION")"
      ;;
    candidate-untagged)
      traffic="$(printf '[{"percent":100,"revisionName":"%s"}]' "$CANDIDATE_REVISION")"
      ;;
  esac
  printf '{"metadata":{"labels":{"source-commit":"%s","managed-by":"cloud-build","product":"lifesnap-action","environment":"production","release-build":"%s"}},"status":{"url":"https://service.example","traffic":%s}}\\n' "$COMMIT_SHA" "$SERVICE_RELEASE_BUILD_ID" "$traffic"
elif [[ "$args" == *"--to-revisions=$CANDIDATE_REVISION=100"* ]]; then
  printf 'candidate-tagged\\n' > "$TRAFFIC_STATE"
elif [[ "$args" == *"--to-revisions=$ROLLBACK_REVISION=100"* ]]; then
  printf 'rollback-tagged\\n' > "$TRAFFIC_STATE"
elif [[ "$args" == *"--remove-tags=$CANDIDATE_TAG"* ]]; then
  if [[ "$state" == candidate-tagged ]]; then
    printf 'candidate-untagged\\n' > "$TRAFFIC_STATE"
  else
    printf 'rollback-untagged\\n' > "$TRAFFIC_STATE"
  fi
fi
`,
  );

  return {
    binDirectory,
    buildId,
    candidateRevision,
    candidateTag,
    commitSha,
    env: {
      ...process.env,
      BUILD_ID: buildId,
      COMMIT_SHA: commitSha,
      DEPLOY_REGION: "asia-northeast1",
      FAIL_PRODUCTION_CURL: failProductionCurl ? "1" : "0",
      GCLOUD_LOG: gcloudLog,
      PATH: `${binDirectory}:${process.env.PATH}`,
      PROJECT_ID: "test-project",
      RELEASE_WORKSPACE: workspace,
      REMOTE_MAIN_SHA: commitSha,
      REPOSITORY_URL: "https://github.com/zll6796096/LifeSnap-Action.git",
      ROLLBACK_REVISION: rollbackRevision,
      CANDIDATE_REVISION: candidateRevision,
      CANDIDATE_TAG: candidateTag,
      SERVICE_NAME: "lifesnap-action",
      SERVICE_RELEASE_BUILD_ID: buildId,
      SHORT_SHA: "aaaaaaa",
      TRAFFIC_STATE: trafficState,
    },
    gcloudLog,
    rollbackRevision,
    trafficState,
    workspace,
  };
}

function runReleaseScript(fixture: ReleaseFixture) {
  return spawnSync("bash", [releaseScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: fixture.env,
  });
}

async function writeExecutable(path: string, contents: string) {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}
