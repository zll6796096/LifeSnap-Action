import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const configPath = join(repoRoot, "cloudbuild.yaml");
const dockerfilePath = join(repoRoot, "Dockerfile");
const packagePath = join(repoRoot, "package.json");
const releaseScriptPath = join(repoRoot, "scripts/promote-and-verify.sh");
const promotionScriptPath = join(
  repoRoot,
  "scripts/promote-verified-candidate.sh",
);
const temporaryDirectories: string[] = [];

type BuildStep = {
  id: string;
  name: string;
  args?: string[];
  env?: string[];
};

type ServiceState = {
  apiVersion: string;
  kind: string;
  metadata: {
    annotations: Record<string, string>;
    labels: Record<string, string>;
    name: string;
    namespace: string;
    generation: number;
    resourceVersion: string;
  };
  spec: {
    template: {
      metadata: {
        labels: Record<string, string>;
        name: string;
      };
      spec: {
        containerConcurrency?: number;
        containers: Array<{
          env?: Array<Record<string, unknown>>;
          image: string;
        }>;
        serviceAccountName: string;
      };
    };
    traffic: Array<{
      latestRevision?: boolean;
      percent?: number;
      revisionName?: string;
      tag?: string;
    }>;
  };
  status: {
    conditions: Array<{ status: string; type: string }>;
    latestCreatedRevisionName: string;
    latestReadyRevisionName: string;
    observedGeneration: number;
    traffic: Array<{
      latestRevision?: boolean;
      percent?: number;
      revisionName?: string;
      tag?: string;
      url?: string;
    }>;
    url: string;
  };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("Cloud Build release contract", () => {
  it("keeps every Cloud Run mutation and verification in one orchestrated step", async () => {
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
      "deploy-and-verify-candidate",
    ]);
    expect(config.serviceAccount).toBe(
      "projects/zhang23-23/serviceAccounts/apps-cloud-build@zhang23-23.iam.gserviceaccount.com",
    );
    expect(config.options.logging).toBe("CLOUD_LOGGING_ONLY");
    expect(config.substitutions._LIFESNAP_AR_REPOSITORY).toBe("apps");

    const dockerPush = config.steps.find(({ id }) => id === "docker-push");
    const digestResolver = config.steps.find(
      ({ id }) => id === "resolve-image-digest",
    );
    const release = config.steps.find(
      ({ id }) => id === "deploy-and-verify-candidate",
    );
    expect(dockerPush?.args?.join("\n")).toContain(
      "tee /workspace/lifesnap-docker-push.log",
    );
    expect(digestResolver?.args?.join("\n")).toContain(
      "/workspace/lifesnap-docker-push.log",
    );
    expect(digestResolver?.args?.join("\n")).not.toContain(
      "gcloud artifacts docker images describe",
    );
    expect(release?.args).toEqual([
      "-ceu",
      "./scripts/promote-and-verify.sh",
    ]);
    expect(release?.env).toEqual(
      expect.arrayContaining([
        "COMMIT_SHA=$COMMIT_SHA",
        "SHORT_SHA=$SHORT_SHA",
        "BUILD_ID=$BUILD_ID",
      ]),
    );
  });

  it("ends Cloud Build after validating a tagged zero-traffic candidate", async () => {
    const script = await readFile(releaseScriptPath, "utf8");
    const installTraps = script.indexOf("\ninstall_release_traps\n");
    const deploy = script.indexOf("\ndeploy_candidate\n", installTraps);
    const candidateRuntime = script.indexOf(
      "\nverify_candidate_runtime\n",
      deploy,
    );
    const candidateEndpoints = script.indexOf(
      "\nverify_candidate_endpoints\n",
      candidateRuntime,
    );
    const candidateGate = script.indexOf(
      "candidate_gate=PASS revision=%s url=%s promotion=BLOCKED_BY_DEVICE_SMOKE",
      candidateEndpoints,
    );
    const deployFunction = script.slice(
      script.indexOf("\ndeploy_candidate()"),
      script.indexOf("\nresolve_candidate()"),
    );

    expect(script).toContain("trap 'record_error' ERR");
    expect(script).toContain("trap 'exit 130' INT");
    expect(script).toContain("trap 'exit 143' TERM");
    expect(script).toContain("trap 'on_exit $?' EXIT");
    expect(script).toContain('candidate_tag="candidate-${SHORT_SHA}-');
    expect(script).toContain(
      "https://${DEPLOY_REGION}-run.googleapis.com/apis/serving.knative.dev/v1/",
    );
    expect(script).toContain("--request PUT");
    expect(script).toContain(
      '"resourceVersion": metadata["resourceVersion"]',
    );
    expect(script).toContain("cleanup_failed_release");
    expect(script).not.toContain("--request PATCH");
    expect(script).not.toContain("updateMask=");
    expect(script).not.toContain("gcloud run services update");
    expect(script).not.toContain("run services update-traffic");
    expect(deployFunction).toContain("prepare_candidate_payload");
    expect(deployFunction).toContain("conditional_replace");
    expect(script).toContain('"resourceVersion": resource_version');
    expect(installTraps).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(installTraps);
    expect(candidateRuntime).toBeGreaterThan(deploy);
    expect(candidateEndpoints).toBeGreaterThan(candidateRuntime);
    expect(candidateGate).toBeGreaterThan(candidateEndpoints);
    expect(script.slice(candidateEndpoints)).not.toContain(
      "\nconditionally_promote_candidate\n",
    );
    expect(script.slice(candidateEndpoints)).not.toContain(
      "\nverify_production_endpoints ",
    );
  });

  it("uses a non-vulnerable direct yaml parser version", async () => {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
      devDependencies: Record<string, string>;
    };

    expect(packageJson.devDependencies.yaml).toBe("2.9.0");
  });

  it("builds and runs with supported Node 24 and production-only non-root dependencies", async () => {
    const config = parse(await readFile(configPath, "utf8")) as {
      steps: BuildStep[];
    };
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const npmSteps = config.steps.filter(({ id }) => id.startsWith("npm-"));
    const nodeBaseImages = dockerfile
      .split("\n")
      .filter((line) => line.startsWith("FROM node:"));

    expect(npmSteps.map(({ name }) => name)).toEqual([
      "node:24",
      "node:24",
      "node:24",
      "node:24",
    ]);
    expect(nodeBaseImages.length).toBeGreaterThanOrEqual(2);
    expect(nodeBaseImages.every((line) => line.startsWith("FROM node:24-slim"))).toBe(
      true,
    );
    expect(dockerfile).toContain("RUN npm ci --omit=dev");
    expect(dockerfile).toContain("--from=production-dependencies");
    expect(dockerfile).not.toContain("COPY --from=builder /app/node_modules");
    expect(dockerfile.indexOf("USER node")).toBeGreaterThan(
      dockerfile.indexOf("ENV NODE_ENV=production"),
    );
    expect(dockerfile.indexOf("CMD [\"node\", \"dist/server.cjs\"]")).toBeGreaterThan(
      dockerfile.indexOf("USER node"),
    );
  });

  it("keeps production unchanged after candidate validation", async () => {
    const fixture = await createReleaseFixture();
    const result = runReleaseScript(fixture);
    const state = await readServiceState(fixture);
    const calls = await readFile(fixture.curlLog, "utf8");

    expect(result.status, result.stderr).toBe(0);
    expect(state.metadata.labels).toEqual(fixture.initialLabels);
    expect(state.spec.traffic).toEqual([
      {
        percent: 100,
        revisionName: fixture.rollbackRevision,
      },
      {
        latestRevision: true,
        percent: 0,
        tag: fixture.candidateTag,
      },
    ]);
    expect(result.stdout).toContain(
      `candidate_gate=PASS revision=${fixture.candidateRevision} url=https://candidate.example promotion=BLOCKED_BY_DEVICE_SMOKE`,
    );
    expect(calls).not.toContain(
      `PUT source=${fixture.commitSha} resourceVersion=rv-2 result=applied`,
    );
  });

  it("stamps the candidate revision without changing old service provenance or traffic", async () => {
    const script = await readFile(releaseScriptPath, "utf8");
    const fixture = await createReleaseFixture();
    const result = runReleaseScript(fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(script).toContain("/usr/libexec/PlistBuddy");
    expect(script).toContain("plistlib.load");

    const candidateSnapshot = JSON.parse(
      await readFile(fixture.candidateSnapshot, "utf8"),
    ) as {
      environment: Array<Record<string, unknown>>;
      image: string;
      containerConcurrency: number;
      revisionLabels: Record<string, string>;
      serviceAccountName: string;
      serviceLabels: Record<string, string>;
      traffic: ServiceState["spec"]["traffic"];
    };
    const calls = await readFile(fixture.curlLog, "utf8");
    const revisionChecks = calls
      .split("\n")
      .filter((line) => line.startsWith("revision-describe "));

    expect(candidateSnapshot.serviceLabels).toEqual(fixture.initialLabels);
    expect(candidateSnapshot.revisionLabels).toMatchObject({
      environment: "production",
      "managed-by": "cloud-build",
      product: "lifesnap-action",
      "release-build": fixture.buildId,
      "source-commit": fixture.commitSha,
      "api-contract": "v2-app-check",
    });
    expect(candidateSnapshot.image).toBe(fixture.imageDigest);
    expect(candidateSnapshot.containerConcurrency).toBe(4);
    expect(candidateSnapshot.serviceAccountName).toBe(
      "lifesnap-runtime@zhang23-23.iam.gserviceaccount.com",
    );
    expect(candidateSnapshot.environment).toEqual(
      expect.arrayContaining([
        {
          name: "GEMINI_API_KEY",
          valueFrom: {
            secretKeyRef: {
              key: "latest",
              name: "lifesnap-gemini-api-key",
            },
          },
        },
        {
          name: "INSTALLATION_HMAC_KEY",
          valueFrom: {
            secretKeyRef: {
              key: "latest",
              name: "lifesnap-installation-hmac-key",
            },
          },
        },
        { name: "FIREBASE_PROJECT_ID", value: "zhang23-23" },
        {
          name: "FIREBASE_APP_ID",
          value: "1:788259830737:ios:a2f98135f554376697bef0",
        },
        { name: "FIRESTORE_DATABASE_ID", value: "lifesnap-quota" },
      ]),
    );
    expect(candidateSnapshot.traffic).toEqual([
      {
        percent: 100,
        revisionName: fixture.rollbackRevision,
      },
      {
        latestRevision: true,
        percent: 0,
        tag: fixture.candidateTag,
      },
    ]);
    expect(revisionChecks).toHaveLength(1);
  });

  it("smokes legacy success and stable no-store v2 rejections", async () => {
    const script = await readFile(releaseScriptPath, "utf8");

    expect(script).toContain('"${candidate_url}/health"');
    expect(script).toContain('"${candidate_url}/privacy"');
    expect(script).toContain('"${candidate_url}/api/extract"');
    expect(script.match(/  verify_negative_v2_response \\$/gm)).toHaveLength(2);
    expect(script).toContain('"missing-token"');
    expect(script).toContain('"invalid-token"');
    expect(script).toContain('expected_code="APP_CHECK_REQUIRED"');
    expect(script).toContain('expected_code="APP_CHECK_INVALID"');
    expect(script).toContain("cache-control: no-store");
  });

  it("keeps promotion in an evidence-gated exact-candidate script", async () => {
    const script = await readFile(promotionScriptPath, "utf8");

    for (const name of [
      "CANDIDATE_REVISION",
      "CANDIDATE_TAG",
      "EXPECTED_IMAGE_DIGEST",
      "EXPECTED_SOURCE_COMMIT",
      "DEVICE_SMOKE_EVIDENCE",
    ]) {
      expect(script).toContain(`:\x20"\${${name}:?${name} is required}"`);
    }
    expect(script).toContain("docs/verification/yotei-snap-security");
    expect(script).toContain('"app_attest_provider": "PASS"');
    expect(script).toContain('"v2_extract": "PASS"');
    expect(script).toContain('"replay_rejected": "PASS"');
    expect(script).toContain("evidence_sha256=");
    expect(script).toContain('labels.get("api-contract") != "v2-app-check"');
    expect(script).toContain(
      "RUNTIME_SERVICE_ACCOUNT=lifesnap-runtime@zhang23-23.iam.gserviceaccount.com",
    );
    expect(script).toContain('"resourceVersion": metadata["resourceVersion"]');
    expect(script).toContain('"percent": 100');
    expect(script).toContain("promotion_rollback_revision=");
    expect(script).not.toContain("APP_CHECK_TOKEN");
  });

  it("promotes only the exact candidate named by sanitized device evidence", async () => {
    const fixture = await createReleaseFixture();
    const candidateResult = runReleaseScript(fixture);
    expect(candidateResult.status, candidateResult.stderr).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);

    const result = runPromotionScript(fixture, evidence);
    const state = await readServiceState(fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^evidence_sha256=[0-9a-f]{64}$/m);
    expect(result.stdout).not.toContain("app_attest_provider");
    expect(result.stdout).not.toContain("replay_rejected");
    expect(state.spec.traffic).toEqual([
      { percent: 100, revisionName: fixture.candidateRevision },
    ]);
    expect(state.metadata.labels).toMatchObject({
      "managed-by": "verified-device-promotion",
      "source-commit": fixture.commitSha,
    });
  });

  it("blocks promotion when production changed after device smoke began", async () => {
    const fixture = await createReleaseFixture();
    const candidateResult = runReleaseScript(fixture);
    expect(candidateResult.status, candidateResult.stderr).toBe(0);
    const evidence = await writeDeviceEvidence(fixture, {
      productionRevision: "lifesnap-action-00097-stale",
    });
    const callsBefore = await readFile(fixture.curlLog, "utf8");

    const result = runPromotionScript(fixture, evidence);
    const callsAfter = await readFile(fixture.curlLog, "utf8");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Production changed after device smoke began");
    const mutationCalls = (calls: string) =>
      calls.split("\n").filter((line) => line.startsWith("PUT "));
    expect(mutationCalls(callsAfter)).toEqual(mutationCalls(callsBefore));
  });

  it("blocks promotion when the candidate upload concurrency contract drifts", async () => {
    const fixture = await createReleaseFixture();
    const candidateResult = runReleaseScript(fixture);
    expect(candidateResult.status, candidateResult.stderr).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);
    fixture.env.CANDIDATE_CONCURRENCY_OVERRIDE = "80";
    const callsBefore = await readFile(fixture.curlLog, "utf8");

    const result = runPromotionScript(fixture, evidence);
    const callsAfter = await readFile(fixture.curlLog, "utf8");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Candidate container concurrency mismatch");
    expect(mutationCalls(callsAfter)).toEqual(mutationCalls(callsBefore));
  });

  it.each([
    ["candidate revision", { candidateRevision: "lifesnap-action-00097-other" }],
    ["candidate tag", { candidateTag: "candidate-bbbbbbb-other" }],
    [
      "image digest",
      {
        imageDigest:
          "asia-northeast1-docker.pkg.dev/test-project/apps/lifesnap-action@" +
          `sha256:${"e".repeat(64)}`,
      },
    ],
    ["source commit", { sourceCommit: "c".repeat(40) }],
  ])(
    "rejects mismatched %s evidence before promotion mutation",
    async (_label, overrides) => {
      const fixture = await createReleaseFixture();
      const candidateResult = runReleaseScript(fixture);
      expect(candidateResult.status, candidateResult.stderr).toBe(0);
      const evidence = await writeDeviceEvidence(fixture, overrides);
      const callsBefore = await readFile(fixture.curlLog, "utf8");

      const result = runPromotionScript(fixture, evidence);
      const callsAfter = await readFile(fixture.curlLog, "utf8");

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Evidence candidate identity mismatch");
      expect(mutationCalls(callsAfter)).toEqual(mutationCalls(callsBefore));
    },
  );

  it("rejects all non-allowlisted sensitive and unknown evidence fields", async () => {
    const fixture = await createReleaseFixture();
    const candidateResult = runReleaseScript(fixture);
    expect(candidateResult.status, candidateResult.stderr).toBe(0);
    const callsBefore = await readFile(fixture.curlLog, "utf8");
    const forbiddenLines = [
      "token=credential-value",
      "request_body=private-value",
      "response_body=private-value",
      "request_headers=private-value",
      "base64=private-value",
      "installation_uuid=private-value",
      "installation_hmac=private-value",
      "image_content=private-value",
      "ocr_text=private-value",
      "secret=private-value",
      "credential=private-value",
      "calendar_title=private-value",
    ];

    for (const extraLine of forbiddenLines) {
      const evidence = await writeDeviceEvidence(fixture, {
        extraLines: [extraLine],
      });
      const result = runPromotionScript(fixture, evidence);
      const callsAfter = await readFile(fixture.curlLog, "utf8");

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Evidence field is not allowed");
      expect(result.stderr).not.toContain(extraLine);
      expect(result.stdout).not.toContain(extraLine);
      expect(mutationCalls(callsAfter)).toEqual(mutationCalls(callsBefore));
    }
  });

  it("restores the prior traffic when owned promotion smoke fails", async () => {
    const fixture = await createReleaseFixture({
      failProductionValidation: true,
    });
    const candidateResult = runReleaseScript(fixture);
    expect(candidateResult.status, candidateResult.stderr).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);

    const result = runPromotionScript(fixture, evidence);
    const state = await readServiceState(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `promotion_rollback=PASS revision=${fixture.rollbackRevision}`,
    );
    expect(state.metadata.labels).toEqual(fixture.initialLabels);
    expect(state.spec.traffic).toEqual([
      {
        percent: 100,
        revisionName: fixture.rollbackRevision,
      },
      {
        latestRevision: true,
        percent: 0,
        tag: fixture.candidateTag,
      },
    ]);
  });

  it("waits for rollback traffic, readiness, and observed generation before PASS", async () => {
    const fixture = await createReleaseFixture({
      delayRollbackReconciliation: true,
      failProductionValidation: true,
    });
    expect(runReleaseScript(fixture).status).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);

    const result = runPromotionScript(fixture, evidence);
    const state = await readServiceState(fixture);
    const calls = await readFile(fixture.curlLog, "utf8");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `promotion_rollback=PASS revision=${fixture.rollbackRevision}`,
    );
    expect(
      calls.match(/rollback-reconciliation-read/g) ?? [],
      calls,
    ).toHaveLength(2);
    expect(state.status.conditions).toContainEqual({
      status: "True",
      type: "Ready",
    });
    expect(state.status.observedGeneration).toBe(state.metadata.generation);
    expect(
      state.status.traffic.map(({ url: _url, ...target }) => target),
    ).toEqual([
      { percent: 100, revisionName: fixture.rollbackRevision },
      {
        percent: 0,
        revisionName: fixture.candidateRevision,
        tag: fixture.candidateTag,
      },
    ]);
  });

  it("fails visibly without a rollback PASS when reconciliation times out", async () => {
    const fixture = await createReleaseFixture({
      delayRollbackReconciliation: true,
      failProductionValidation: true,
      neverRollbackReconciliation: true,
    });
    fixture.env.ROLLBACK_MAX_ATTEMPTS = "2";
    expect(runReleaseScript(fixture).status).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);

    const result = runPromotionScript(fixture, evidence);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "promotion_rollback_reconciliation=TIMEOUT attempts=2",
    );
    expect(result.stderr).not.toContain("promotion_rollback=PASS");
    expect(result.stderr).toContain("promotion_rollback=FAILED code=1");
  });

  it("rolls back only traffic and promotion-owned provenance fields", async () => {
    const fixture = await createReleaseFixture({
      concurrentOwnedSpecChangeOnFailure: true,
      failProductionValidation: true,
    });
    expect(runReleaseScript(fixture).status).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);

    const result = runPromotionScript(fixture, evidence);
    const state = await readServiceState(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("promotion_rollback=PASS");
    expect(state.metadata.labels).toEqual({
      ...fixture.initialLabels,
      "concurrent-label": "preserve-me",
    });
    expect(state.spec.template.spec.containerConcurrency).toBe(17);
    expect(state.spec.traffic).toEqual([
      { percent: 100, revisionName: fixture.rollbackRevision },
      {
        latestRevision: true,
        percent: 0,
        tag: fixture.candidateTag,
      },
    ]);
  });

  it("uses the script location as the evidence and asset trust root", async () => {
    const fixture = await createReleaseFixture();
    expect(runReleaseScript(fixture).status).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);
    const foreignCwd = await mkdtemp(join(tmpdir(), "lifesnap-foreign-cwd-"));
    temporaryDirectories.push(foreignCwd);

    const result = runPromotionScript(fixture, evidence, { cwd: foreignCwd });

    expect(result.status, result.stderr).toBe(0);
    expect((await readServiceState(fixture)).spec.traffic).toEqual([
      { percent: 100, revisionName: fixture.candidateRevision },
    ]);
  });

  it("rejects lookalike relative evidence from a foreign cwd before PUT", async () => {
    const fixture = await createReleaseFixture();
    expect(runReleaseScript(fixture).status).toBe(0);
    const approvedEvidence = await writeDeviceEvidence(fixture);
    const foreignCwd = await mkdtemp(join(tmpdir(), "lifesnap-lookalike-"));
    temporaryDirectories.push(foreignCwd);
    const relativeEvidence = "docs/verification/yotei-snap-security/device.txt";
    const lookalike = join(foreignCwd, relativeEvidence);
    await mkdir(join(lookalike, ".."), { recursive: true });
    await writeFile(lookalike, await readFile(approvedEvidence));
    const callsBefore = await readFile(fixture.curlLog, "utf8");

    const result = runPromotionScript(fixture, relativeEvidence, {
      cwd: foreignCwd,
    });
    const callsAfter = await readFile(fixture.curlLog, "utf8");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/approved directory|No such file or directory/);
    expect(mutationCalls(callsAfter)).toEqual(mutationCalls(callsBefore));
  });

  it("creates a unique private scratch directory for every invocation", async () => {
    const fixture = await createReleaseFixture();
    expect(runReleaseScript(fixture).status).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);

    expect(runPromotionScript(fixture, evidence).status).toBe(0);
    runPromotionScript(fixture, evidence);
    const calls = await readFile(fixture.curlLog, "utf8");
    const scratchEntries = calls
      .split("\n")
      .filter((line) => line.startsWith("promotion-scratch "))
      .map((line) => Object.fromEntries(
        line.slice("promotion-scratch ".length)
          .split(" ")
          .map((entry) => entry.split("=")),
      ));
    const scratchDirectories = [...new Set(scratchEntries.map(({ dir }) => dir))];

    expect(scratchDirectories).toHaveLength(2);
    const canonicalWorkspace = await realpath(fixture.workspace);
    expect(scratchDirectories.every((path) =>
      path.startsWith(`${canonicalWorkspace}/lifesnap-promotion.`),
    )).toBe(true);
    expect(scratchEntries.every(({ mode }) => mode === "700")).toBe(true);
    expect(
      (await readdir(fixture.workspace)).filter((name) =>
        name.startsWith("lifesnap-promotion."),
      ),
    ).toEqual([]);
  });

  it("does not follow precreated predictable scratch symlinks", async () => {
    const fixture = await createReleaseFixture();
    expect(runReleaseScript(fixture).status).toBe(0);
    const evidence = await writeDeviceEvidence(fixture);
    const sentinel = join(fixture.workspace, "sentinel.txt");
    await writeFile(sentinel, "do-not-overwrite\n");
    await symlink(
      sentinel,
      join(fixture.workspace, "lifesnap-promotion-initial.json"),
    );

    const result = runPromotionScript(fixture, evidence);

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(sentinel, "utf8")).toBe("do-not-overwrite\n");
  });

  it("cleans a failed candidate validation and restores prior provenance", async () => {
    const fixture = await createReleaseFixture({
      failCandidateValidation: true,
    });
    const result = runReleaseScript(fixture);
    const state = await readServiceState(fixture);
    const calls = await readFile(fixture.curlLog, "utf8");
    const appliedReplacements = calls
      .split("\n")
      .filter((line) => line.includes("PUT") && line.includes("result=applied"));

    expect(result.status).not.toBe(0);
    expect(calls).toContain("candidate-validation=failed");
    expect(appliedReplacements).toHaveLength(2);
    expect(calls).toContain(
      `PUT candidate source=${fixture.commitSha} service_source=${fixture.initialLabels["source-commit"]} resourceVersion=rv-1 result=applied`,
    );
    expect(state.metadata.labels).toEqual(fixture.initialLabels);
    expect(state.spec.traffic).toEqual([
      {
        percent: 100,
        revisionName: fixture.rollbackRevision,
      },
    ]);
    expect(state.spec.template.metadata.labels).toMatchObject({
      "release-build": fixture.buildId,
      "source-commit": fixture.commitSha,
    });
  });

  it("preserves a concurrent candidate while cleaning its failed candidate", async () => {
    const fixture = await createReleaseFixture({
      concurrentCandidateOnFailure: true,
      failCandidateValidation: true,
    });

    const result = runReleaseScript(fixture);
    const state = await readServiceState(fixture);

    expect(result.status).not.toBe(0);
    expect(state.metadata.labels).toEqual(fixture.initialLabels);
    expect(state.spec.traffic).toEqual([
      {
        percent: 100,
        revisionName: fixture.rollbackRevision,
      },
      {
        percent: 0,
        revisionName: "lifesnap-action-00100-concurrent",
        tag: "candidate-concurrent-build",
      },
    ]);
    expect(state.spec.traffic).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: fixture.candidateTag }),
      ]),
    );
  });

  it("rejects and restores candidate deployment provenance mutation", async () => {
    const fixture = await createReleaseFixture({
      mutateCandidateProvenance: true,
    });
    const result = runReleaseScript(fixture);
    const state = await readServiceState(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Candidate deployment changed service provenance labels",
    );
    expect(state.metadata.labels).toEqual(fixture.initialLabels);
    expect(state.spec.traffic).toEqual([
      {
        percent: 100,
        revisionName: fixture.rollbackRevision,
      },
    ]);
  });

});

type ReleaseFixture = {
  binDirectory: string;
  buildId: string;
  candidateRevision: string;
  candidateSnapshot: string;
  candidateTag: string;
  commitSha: string;
  curlLog: string;
  env: NodeJS.ProcessEnv;
  imageDigest: string;
  initialLabels: Record<string, string>;
  rollbackRevision: string;
  serviceState: string;
  workspace: string;
};

type ReleaseFixtureOptions = {
  concurrentCandidateOnFailure?: boolean;
  concurrentOwnedSpecChangeOnFailure?: boolean;
  delayRollbackReconciliation?: boolean;
  failCandidateValidation?: boolean;
  failProductionValidation?: boolean;
  injectStalePromotion?: boolean;
  mutateCandidateProvenance?: boolean;
  neverRollbackReconciliation?: boolean;
  termAfterPromotion?: boolean;
  termWithNewerOwner?: boolean;
};

async function createReleaseFixture(
  options: ReleaseFixtureOptions = {},
): Promise<ReleaseFixture> {
  const root = await mkdtemp(join(tmpdir(), "lifesnap-release-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  const binDirectory = join(root, "bin");
  const commitSha = "a".repeat(40);
  const buildId = "build123-dead-beef-cafe";
  const candidateRevision = "lifesnap-action-00099-test";
  const rollbackRevision = "lifesnap-action-00098-safe";
  const candidateTag = "candidate-aaaaaaa-build123";
  const serviceState = join(root, "service-state.json");
  const candidateSnapshot = join(root, "candidate-snapshot.json");
  const curlLog = join(root, "curl.log");
  const staleInjectionFlag = join(root, "stale-injected");
  const rollbackPendingFlag = join(root, "rollback-pending");
  const rollbackReadCount = join(root, "rollback-read-count");
  const imageDigest =
    `asia-northeast1-docker.pkg.dev/test-project/apps/lifesnap-action@` +
    `sha256:${"d".repeat(64)}`;
  const initialLabels = {
    environment: "production",
    "managed-by": "cloud-build",
    product: "lifesnap-action",
    "release-build": "previous-build-001",
    "source-commit": "b".repeat(40),
  };
  const initialState: ServiceState = {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: {
      annotations: {
        "run.googleapis.com/ingress": "all",
      },
      labels: initialLabels,
      name: "lifesnap-action",
      namespace: "123456789",
      generation: 1,
      resourceVersion: "rv-1",
    },
    spec: {
      template: {
        metadata: {
          labels: initialLabels,
          name: rollbackRevision,
        },
        spec: {
          containers: [
            {
              env: [
                { name: "MOCK_MODE", value: "false" },
                {
                  name: "GEMINI_API_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      key: "latest",
                      name: "lifesnap-gemini-api-key",
                    },
                  },
                },
              ],
              image: "rollback-image@sha256:safe",
            },
          ],
          serviceAccountName:
            "runtime-service-account@test-project.iam.gserviceaccount.com",
        },
      },
      traffic: [
        {
          percent: 100,
          revisionName: rollbackRevision,
        },
      ],
    },
    status: {
      conditions: [{ status: "True", type: "Ready" }],
      latestCreatedRevisionName: rollbackRevision,
      latestReadyRevisionName: rollbackRevision,
      observedGeneration: 1,
      traffic: [
        {
          percent: 100,
          revisionName: rollbackRevision,
        },
      ],
      url: "https://service.example",
    },
  };

  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(binDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(workspace, "lifesnap-image-digest.txt"),
      `${imageDigest}\n`,
    ),
    writeFile(serviceState, `${JSON.stringify(initialState)}\n`),
    writeFile(curlLog, ""),
  ]);

  await writeExecutable(
    join(binDirectory, "git"),
    `#!/usr/bin/env node
process.stdout.write(process.env.REMOTE_MAIN_SHA + "\\trefs/heads/main\\n");
`,
  );
  await writeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const text = args.join(" ");
const readState = () => JSON.parse(fs.readFileSync(process.env.SERVICE_STATE, "utf8"));
const writeState = (state) =>
  fs.writeFileSync(process.env.SERVICE_STATE, JSON.stringify(state) + "\\n");
const value = (prefix) => {
  const item = args.find((argument) => argument.startsWith(prefix + "="));
  return item ? item.slice(prefix.length + 1) : "";
};
if (text === "auth print-access-token") {
  process.stdout.write("fake-access-token\\n");
} else if (text.includes("run services describe ")) {
  process.stdout.write(JSON.stringify(readState()) + "\\n");
} else if (text.includes("run revisions describe ")) {
  const state = readState();
  fs.appendFileSync(
    process.env.CURL_LOG,
    "revision-describe source=" +
      state.spec.template.metadata.labels["source-commit"] +
      " build=" +
      state.spec.template.metadata.labels["release-build"] +
      " image=" +
      state.spec.template.spec.containers[0].image +
      "\\n",
  );
  process.stdout.write(JSON.stringify({
    metadata: {
      name: process.env.CANDIDATE_REVISION,
      labels: state.spec.template.metadata.labels,
    },
    spec: {
      containers: [{
        env: state.spec.template.spec.containers[0].env,
      }],
      containerConcurrency: Number(
        process.env.CANDIDATE_CONCURRENCY_OVERRIDE ||
          state.spec.template.spec.containerConcurrency
      ),
      serviceAccountName: state.spec.template.spec.serviceAccountName,
    },
    status: {
      conditions: [{ status: "True", type: "Ready" }],
      imageDigest: state.spec.template.spec.containers[0].image,
    },
  }) + "\\n");
} else {
  process.stderr.write("unexpected gcloud call: " + text + "\\n");
  process.exit(2);
}
`,
  );
  await writeExecutable(
    join(binDirectory, "curl"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
let method = "GET";
let output = "";
let dataFile = "";
let headerOutput = "";
let writeOut = "";
const requestHeaders = [];
let url = "";
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--request" || argument === "-X") {
    method = args[++index];
  } else if (argument === "--output" || argument === "-o") {
    output = args[++index];
  } else if (argument === "--data-binary") {
    dataFile = args[++index].replace(/^@/, "");
  } else if (argument === "--dump-header") {
    headerOutput = args[++index];
  } else if (argument === "--write-out") {
    writeOut = args[++index];
  } else if (argument === "--header") {
    requestHeaders.push(args[++index]);
  } else if (argument.startsWith("http")) {
    url = argument;
  }
}
const readState = () => JSON.parse(fs.readFileSync(process.env.SERVICE_STATE, "utf8"));
const writeState = (state) =>
  fs.writeFileSync(process.env.SERVICE_STATE, JSON.stringify(state) + "\\n");
const respond = (contents, status = 200, headers = []) => {
  if (output) {
    fs.writeFileSync(output, contents);
  } else {
    process.stdout.write(contents);
  }
  if (headerOutput) {
    fs.writeFileSync(
      headerOutput,
      "HTTP/1.1 " + status + " Fixture\\r\\n" +
        headers.join("\\r\\n") + "\\r\\n\\r\\n",
    );
  }
  if (writeOut) {
    process.stdout.write(String(status));
  }
};
const log = (line) =>
  fs.appendFileSync(process.env.CURL_LOG, line + "\\n");
const bumpResourceVersion = (resourceVersion) => {
  const match = String(resourceVersion).match(/(\\d+)$/);
  return "rv-" + (match ? Number(match[1]) + 1 : 100);
};
const serviceUrl =
  "https://asia-northeast1-run.googleapis.com/apis/serving.knative.dev/" +
  "v1/namespaces/test-project/services/lifesnap-action";
if (url === serviceUrl && method === "GET") {
  let state = readState();
  if (output && output.includes("lifesnap-promotion")) {
    const directory = path.dirname(output);
    const mode = (fs.statSync(directory).mode & 0o777).toString(8);
    log("promotion-scratch dir=" + directory + " mode=" + mode);
  }
  if (fs.existsSync(process.env.ROLLBACK_PENDING_FLAG)) {
    const count = fs.existsSync(process.env.ROLLBACK_READ_COUNT)
      ? Number(fs.readFileSync(process.env.ROLLBACK_READ_COUNT, "utf8")) + 1
      : 1;
    fs.writeFileSync(process.env.ROLLBACK_READ_COUNT, String(count));
    log("rollback-reconciliation-read count=" + count);
    if (
      count >= 2 &&
      process.env.NEVER_ROLLBACK_RECONCILIATION !== "1"
    ) {
      state.status.traffic = state.spec.traffic.map((target) => ({
        ...(target.latestRevision
          ? {
              percent: target.percent,
              revisionName: process.env.CANDIDATE_REVISION,
              tag: target.tag,
            }
          : target),
        ...(target.tag ? { url: "https://candidate.example" } : {}),
      }));
      state.status.observedGeneration = state.metadata.generation;
      fs.unlinkSync(process.env.ROLLBACK_PENDING_FLAG);
      writeState(state);
    }
  }
  respond(JSON.stringify(state) + "\\n");
} else if (url === serviceUrl && method === "PUT") {
  const state = readState();
  const payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const source = payload.metadata.labels?.["source-commit"] || "none";
  const candidateTarget = payload.spec.traffic.find(
    (target) =>
      target.tag === process.env.CANDIDATE_TAG &&
      target.latestRevision === true &&
      target.percent === 0,
  );
  const revisionLabels = payload.spec.template.metadata.labels || {};
  const isCandidateCreation =
    source !== process.env.COMMIT_SHA &&
    !state.metadata.labels["promotion-owner"] &&
    revisionLabels["source-commit"] === process.env.COMMIT_SHA &&
    revisionLabels["release-build"] === process.env.BUILD_ID &&
    Boolean(candidateTarget);
  const isPromotion = source === process.env.COMMIT_SHA;
  if (
    isPromotion &&
    process.env.INJECT_STALE_PROMOTION === "1" &&
    !fs.existsSync(process.env.STALE_INJECTION_FLAG)
  ) {
    fs.writeFileSync(process.env.STALE_INJECTION_FLAG, "injected\\n");
    state.metadata.resourceVersion = "rv-99";
    state.metadata.labels = {
      ...state.metadata.labels,
      "release-build": "newer-build-456",
      "source-commit": "c".repeat(40),
    };
    writeState(state);
    log(
      "PUT source=" + source + " resourceVersion=" +
      payload.metadata.resourceVersion +
      " result=precondition-failed",
    );
    respond('{"error":{"code":409,"status":"ABORTED"}}\\n');
    process.exit(22);
  }
  if (
    payload.metadata.resourceVersion !== state.metadata.resourceVersion
  ) {
    log(
      "PUT source=" + source + " resourceVersion=" +
      payload.metadata.resourceVersion +
      " result=precondition-failed",
    );
    respond('{"error":{"code":409,"status":"ABORTED"}}\\n');
    process.exit(22);
  }
  if (isCandidateCreation) {
    fs.writeFileSync(
      process.env.CANDIDATE_SNAPSHOT,
      JSON.stringify({
        environment: payload.spec.template.spec.containers[0].env,
        image: payload.spec.template.spec.containers[0].image,
        containerConcurrency: payload.spec.template.spec.containerConcurrency,
        revisionLabels,
        serviceAccountName: payload.spec.template.spec.serviceAccountName,
        serviceLabels: payload.metadata.labels,
        traffic: payload.spec.traffic,
      }) + "\\n",
    );
    state.metadata.labels =
      process.env.MUTATE_CANDIDATE_PROVENANCE === "1"
        ? {
            ...payload.metadata.labels,
            "release-build": process.env.BUILD_ID,
            "source-commit": process.env.COMMIT_SHA,
          }
        : payload.metadata.labels;
    state.metadata.annotations = payload.metadata.annotations;
    state.spec = payload.spec;
    state.spec.template.metadata.name = process.env.CANDIDATE_REVISION;
    state.metadata.resourceVersion = bumpResourceVersion(
      state.metadata.resourceVersion,
    );
    state.metadata.generation += 1;
    state.status.latestCreatedRevisionName = process.env.CANDIDATE_REVISION;
    state.status.latestReadyRevisionName = process.env.CANDIDATE_REVISION;
    state.status.traffic = state.spec.traffic.map((target) => {
      if (target.latestRevision) {
        return {
          percent: target.percent,
          revisionName: process.env.CANDIDATE_REVISION,
          tag: target.tag,
          url: "https://candidate.example",
        };
      }
      return target;
    });
    state.status.observedGeneration = state.metadata.generation;
    writeState(state);
    log(
      "PUT candidate source=" + revisionLabels["source-commit"] +
      " service_source=" + source +
      " resourceVersion=" + payload.metadata.resourceVersion +
      " result=applied",
    );
    respond(JSON.stringify(state) + "\\n");
    process.exit(0);
  }
  const isRollback =
    source !== process.env.COMMIT_SHA &&
    payload.spec.traffic.some(
      (target) => target.revisionName === process.env.ROLLBACK_REVISION,
    );
  state.metadata.labels = payload.metadata.labels;
  state.metadata.annotations = payload.metadata.annotations;
  state.spec = payload.spec;
  state.metadata.resourceVersion = bumpResourceVersion(
    state.metadata.resourceVersion,
  );
  state.metadata.generation += 1;
  if (isRollback && process.env.DELAY_ROLLBACK_RECONCILIATION === "1") {
    fs.writeFileSync(process.env.ROLLBACK_PENDING_FLAG, "pending\\n");
  } else {
    state.status.traffic = state.spec.traffic.map((target) => ({
      ...(target.latestRevision
        ? {
            percent: target.percent,
            revisionName: process.env.CANDIDATE_REVISION,
            tag: target.tag,
          }
        : target),
      ...(target.tag ? { url: "https://candidate.example" } : {}),
    }));
    state.status.observedGeneration = state.metadata.generation;
  }
  const production = state.spec.traffic.find(
    (target) => target.percent === 100,
  );
  if (production) {
    state.status.latestReadyRevisionName = production.revisionName;
  }
  writeState(state);
  log(
    "PUT source=" + source + " resourceVersion=" +
    payload.metadata.resourceVersion +
    " result=applied",
  );
  respond(JSON.stringify(state) + "\\n");
} else if (url.startsWith("https://candidate.example")) {
  if (
    process.env.FAIL_CANDIDATE_VALIDATION === "1" &&
    url.endsWith("/health")
  ) {
    if (process.env.CONCURRENT_CANDIDATE_ON_FAILURE === "1") {
      const state = readState();
      const concurrent = {
        percent: 0,
        revisionName: "lifesnap-action-00100-concurrent",
        tag: "candidate-concurrent-build",
      };
      state.spec.traffic.push(concurrent);
      state.status.traffic.push({
        ...concurrent,
        url: "https://concurrent.example",
      });
      state.metadata.resourceVersion = bumpResourceVersion(
        state.metadata.resourceVersion,
      );
      writeState(state);
      log("concurrent-candidate=added");
    }
    log("candidate-validation=failed");
    process.exit(22);
  }
  if (url.endsWith("/health")) {
    respond('{"status":"ok"}');
  } else if (url.endsWith("/privacy")) {
    respond("Privacy Policy");
  } else if (url.endsWith("/api/extract")) {
    respond(
      '{"title":"test","summary":"test","route":"calendar_action",' +
      '"confidence":90,"evidence":[],"risk_flags":[]}',
    );
  } else if (url.endsWith("/api/v2/extract")) {
    const invalid = requestHeaders.includes("X-Firebase-AppCheck: invalid");
    respond(
      JSON.stringify({
        code: invalid ? "APP_CHECK_INVALID" : "APP_CHECK_REQUIRED",
        error: "Fixture public error",
      }),
      401,
      ["Cache-Control: no-store"],
    );
  }
} else if (url.startsWith("https://service.example")) {
  if (
    process.env.CONCURRENT_OWNED_SPEC_CHANGE_ON_FAILURE === "1" &&
    url.endsWith("/health")
  ) {
    const state = readState();
    state.metadata.labels["concurrent-label"] = "preserve-me";
    state.spec.template.spec.containerConcurrency = 17;
    state.metadata.resourceVersion = bumpResourceVersion(
      state.metadata.resourceVersion,
    );
    state.metadata.generation += 1;
    state.status.observedGeneration = state.metadata.generation;
    writeState(state);
    log("concurrent-owned-update=applied");
  }
  if (
    process.env.FAIL_PRODUCTION_VALIDATION === "1" &&
    url.endsWith("/health")
  ) {
    log("production-validation=failed");
    process.exit(22);
  }
  if (
    process.env.TERM_AFTER_PROMOTION === "1" &&
    url.endsWith("/health")
  ) {
    if (process.env.TERM_WITH_NEWER_OWNER === "1") {
      const state = readState();
      state.metadata.resourceVersion = bumpResourceVersion(
        state.metadata.resourceVersion,
      );
      state.metadata.labels = {
        ...state.metadata.labels,
        "release-build": "newer-build-456",
        "source-commit": "c".repeat(40),
      };
      writeState(state);
    }
    log("signal=TERM");
    process.kill(process.ppid, "SIGTERM");
    setTimeout(() => process.exit(0), 50);
  } else if (url.endsWith("/health")) {
    respond('{"status":"ok"}');
  } else if (url.endsWith("/privacy")) {
    respond("Privacy Policy");
  } else if (url.endsWith("/api/extract")) {
    respond(
      '{"title":"test","summary":"test","route":"calendar_action",' +
      '"confidence":90,"evidence":[],"risk_flags":[]}',
    );
  } else if (url.endsWith("/api/v2/extract")) {
    const invalid = requestHeaders.includes("X-Firebase-AppCheck: invalid");
    respond(
      JSON.stringify({
        code: invalid ? "APP_CHECK_INVALID" : "APP_CHECK_REQUIRED",
        error: "Fixture public error",
      }),
      401,
      ["Cache-Control: no-store"],
    );
  }
} else {
  process.stderr.write("unexpected curl call: " + method + " " + url + "\\n");
  process.exit(2);
}
`,
  );

  return {
    binDirectory,
    buildId,
    candidateRevision,
    candidateSnapshot,
    candidateTag,
    commitSha,
    curlLog,
    env: {
      ...process.env,
      BUILD_ID: buildId,
      CANDIDATE_REVISION: candidateRevision,
      CANDIDATE_SNAPSHOT: candidateSnapshot,
      CANDIDATE_TAG: candidateTag,
      COMMIT_SHA: commitSha,
      CONCURRENT_CANDIDATE_ON_FAILURE:
        options.concurrentCandidateOnFailure ? "1" : "0",
      CONCURRENT_OWNED_SPEC_CHANGE_ON_FAILURE:
        options.concurrentOwnedSpecChangeOnFailure ? "1" : "0",
      CURL_LOG: curlLog,
      DELAY_ROLLBACK_RECONCILIATION:
        options.delayRollbackReconciliation ? "1" : "0",
      DEPLOY_REGION: "asia-northeast1",
      FAIL_CANDIDATE_VALIDATION: options.failCandidateValidation ? "1" : "0",
      FAIL_PRODUCTION_VALIDATION: options.failProductionValidation ? "1" : "0",
      IMAGE_DIGEST: imageDigest,
      INJECT_STALE_PROMOTION: options.injectStalePromotion ? "1" : "0",
      MUTATE_CANDIDATE_PROVENANCE: options.mutateCandidateProvenance
        ? "1"
        : "0",
      NEVER_ROLLBACK_RECONCILIATION:
        options.neverRollbackReconciliation ? "1" : "0",
      PATH: `${binDirectory}:${process.env.PATH}`,
      PROJECT_ID: "test-project",
      RELEASE_WORKSPACE: workspace,
      ROLLBACK_MAX_ATTEMPTS: "5",
      ROLLBACK_PENDING_FLAG: rollbackPendingFlag,
      ROLLBACK_POLL_INTERVAL_SECONDS: "0",
      ROLLBACK_READ_COUNT: rollbackReadCount,
      ROLLBACK_REVISION: rollbackRevision,
      REMOTE_MAIN_SHA: commitSha,
      REPOSITORY_URL: "https://github.com/zll6796096/LifeSnap-Action.git",
      SERVICE_NAME: "lifesnap-action",
      SERVICE_STATE: serviceState,
      SHORT_SHA: "aaaaaaa",
      STALE_INJECTION_FLAG: staleInjectionFlag,
      TERM_AFTER_PROMOTION: options.termAfterPromotion ? "1" : "0",
      TERM_WITH_NEWER_OWNER: options.termWithNewerOwner ? "1" : "0",
    },
    imageDigest,
    initialLabels,
    rollbackRevision,
    serviceState,
    workspace,
  };
}

function runReleaseScript(fixture: ReleaseFixture) {
  return spawnSync("bash", [releaseScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: fixture.env,
    timeout: 5_000,
  });
}

function runPromotionScript(
  fixture: ReleaseFixture,
  evidence: string,
  options: { cwd?: string } = {},
) {
  return spawnSync("bash", [promotionScriptPath], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: {
      ...fixture.env,
      CANDIDATE_REVISION: fixture.candidateRevision,
      CANDIDATE_TAG: fixture.candidateTag,
      DEVICE_SMOKE_EVIDENCE: evidence,
      EXPECTED_IMAGE_DIGEST: fixture.imageDigest,
      EXPECTED_SOURCE_COMMIT: fixture.commitSha,
    },
    timeout: 5_000,
  });
}

type DeviceEvidenceOverrides = {
  candidateRevision?: string;
  candidateTag?: string;
  extraLines?: string[];
  imageDigest?: string;
  productionRevision?: string;
  sourceCommit?: string;
};

function mutationCalls(calls: string) {
  return calls.split("\n").filter((line) => line.startsWith("PUT "));
}

async function writeDeviceEvidence(
  fixture: ReleaseFixture,
  overrides: DeviceEvidenceOverrides = {},
) {
  const evidenceDirectory = await mkdtemp(
    join(
      repoRoot,
      "docs/verification/yotei-snap-security/task12-contract-",
    ),
  );
  temporaryDirectories.push(evidenceDirectory);
  const evidence = join(evidenceDirectory, "device-smoke.txt");
  await writeFile(
    evidence,
    [
      "app_attest_provider=PASS",
      "v2_extract=PASS",
      "replay_rejected=PASS",
      "gemini_valid_request_count=1",
      "gemini_replay_request_count=0",
      `production_revision_before_device_smoke=${overrides.productionRevision ?? fixture.rollbackRevision}`,
      `candidate_revision=${overrides.candidateRevision ?? fixture.candidateRevision}`,
      `candidate_tag=${overrides.candidateTag ?? fixture.candidateTag}`,
      `image_digest=${overrides.imageDigest ?? fixture.imageDigest}`,
      `source_commit=${overrides.sourceCommit ?? fixture.commitSha}`,
      ...(overrides.extraLines ?? []),
      "",
    ].join("\n"),
  );
  return evidence;
}

async function readServiceState(
  fixture: ReleaseFixture,
): Promise<ServiceState> {
  return JSON.parse(await readFile(fixture.serviceState, "utf8")) as ServiceState;
}

async function writeExecutable(path: string, contents: string) {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}
