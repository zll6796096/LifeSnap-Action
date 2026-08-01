import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const helperPath = join(repoRoot, "scripts/manage-lifesnap-trigger.sh");
const temporaryDirectories: string[] = [];
const triggerId = "33acc4f7-4ae1-478f-8ccf-78e9596e121b";
const triggerRegion = "global";
const projectNumber = "788259830737";

type TriggerFixture = Awaited<ReturnType<typeof createTriggerFixture>>;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("Cloud Build trigger lifecycle helper", () => {
  it("persists an exact private snapshot across four independent shell processes", async () => {
    const fixture = await createTriggerFixture();
    const original = await readTrigger(fixture);

    const prepared = runHelper(fixture, "prepare-disable");
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(prepared.stdout).toContain("trigger_lifecycle=PREPARED");
    const manifestPath = manifestPathFrom(prepared.stdout);
    const manifestStat = await lstat(manifestPath);
    const parentStat = await lstat(dirname(manifestPath));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      prior_disabled: boolean;
      project_id: string;
      project_number: string;
      run_state: null | Record<string, unknown>;
      schema_version: number;
      trigger_id: string;
      trigger_region: string;
      trigger_snapshot: Record<string, unknown>;
    };

    expect(manifestStat.isFile()).toBe(true);
    expect(manifestStat.nlink).toBe(1);
    expect(manifestStat.mode & 0o777).toBe(0o600);
    expect(parentStat.mode & 0o777).toBe(0o700);
    expect(manifest).toEqual({
      prior_disabled: false,
      project_id: "test-project",
      project_number: projectNumber,
      run_state: null,
      schema_version: 3,
      trigger_id: triggerId,
      trigger_region: triggerRegion,
      trigger_snapshot: original,
    });
    expect(await readFile(manifestPath, "utf8")).not.toContain(
      "fixture-access-token",
    );
    expect((await readTrigger(fixture)).disabled).toBe(true);

    const verified = runHelper(fixture, "verify-disabled");
    expect(verified.status, verified.stderr).toBe(0);
    expect(verified.stdout).toContain("trigger_lifecycle=DISABLED");
    expect(manifestPathFrom(verified.stdout)).toBe(manifestPath);

    const mergedSha = fixture.mergedSha;
    const run = runHelper(fixture, "run-exact", { MERGED_SHA: mergedSha });
    expect(run.status, run.stderr).toBe(0);
    const runLog = await readFile(fixture.runLog, "utf8");
    expect(run.stdout, `stderr=${run.stderr} runLog=${runLog}`).toContain(
      `trigger_lifecycle=RUN operation_name=operations/build/test-project/operation-123 build_id=build-123 commit=${mergedSha}`,
    );
    expect(runLog.trim().split("\n")).toEqual([
      `RUN trigger=${triggerId} sha=${mergedSha}`,
    ]);
    const acceptedManifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as { run_state: Record<string, unknown> };
    expect(acceptedManifest.run_state).toEqual({
      build_id: "build-123",
      operation_name: "operations/build/test-project/operation-123",
      sha: mergedSha,
      status: "accepted",
    });
    expect((await readTrigger(fixture)).disabled).toBe(true);

    const restored = runHelper(fixture, "restore");
    expect(restored.status, restored.stderr).toBe(0);
    expect(restored.stdout).toContain("trigger_lifecycle=RESTORED");
    expect(await readTrigger(fixture)).toEqual(original);
    await expect(lstat(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is idempotent when an already-disabled trigger is prepared twice", async () => {
    const fixture = await createTriggerFixture({ disabled: true });
    const original = await readTrigger(fixture);

    const first = runHelper(fixture, "prepare-disable");
    const second = runHelper(fixture, "prepare-disable");

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("already_prepared=true");
    expect(await readFile(fixture.patchLog, "utf8")).toBe("");
    const restored = runHelper(fixture, "restore");
    expect(restored.status, restored.stderr).toBe(0);
    expect(await readTrigger(fixture)).toEqual(original);
    await expect(lstat(manifestPathFrom(first.stdout))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves its manifest through disable and restore PATCH failures", async () => {
    const fixture = await createTriggerFixture();

    const failedDisable = runHelper(fixture, "prepare-disable", {
      FAIL_PATCH_MODE: "disable",
    });
    expect(failedDisable.status).not.toBe(0);
    const manifestPath = manifestPathFrom(failedDisable.stdout);
    expect((await lstat(manifestPath)).isFile()).toBe(true);
    expect((await readTrigger(fixture)).disabled).toBeUndefined();

    const retriedDisable = runHelper(fixture, "prepare-disable");
    expect(retriedDisable.status, retriedDisable.stderr).toBe(0);
    expect((await readTrigger(fixture)).disabled).toBe(true);

    const failedRestore = runHelper(fixture, "restore", {
      FAIL_PATCH_MODE: "restore",
    });
    expect(failedRestore.status).not.toBe(0);
    expect((await lstat(manifestPath)).isFile()).toBe(true);
    expect((await readTrigger(fixture)).disabled).toBe(true);

    const restored = runHelper(fixture, "restore");
    expect(restored.status, restored.stderr).toBe(0);
    await expect(lstat(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on trigger drift and never invokes an ambiguous snapshot", async () => {
    const fixture = await createTriggerFixture();
    const prepared = runHelper(fixture, "prepare-disable");
    expect(prepared.status, prepared.stderr).toBe(0);
    const manifestPath = manifestPathFrom(prepared.stdout);
    const drifted = await readTrigger(fixture);
    drifted.description = "concurrent-edit";
    await writeFile(fixture.triggerState, `${JSON.stringify(drifted)}\n`);

    const verified = runHelper(fixture, "verify-disabled");
    const run = runHelper(fixture, "run-exact", {
      MERGED_SHA: "c".repeat(40),
    });
    const restored = runHelper(fixture, "restore");

    expect(verified.status).not.toBe(0);
    expect(run.status).not.toBe(0);
    expect(restored.status).not.toBe(0);
    expect(await readFile(fixture.runLog, "utf8")).toBe("");
    expect((await lstat(manifestPath)).isFile()).toBe(true);
  });

  it("rejects invalid SHAs plus corrupt, mismatched, symlinked, and hard-linked manifests", async () => {
    const invalidShaFixture = await createTriggerFixture();
    const prepared = runHelper(invalidShaFixture, "prepare-disable");
    expect(prepared.status, prepared.stderr).toBe(0);
    const invalidRun = runHelper(invalidShaFixture, "run-exact", {
      MERGED_SHA: "main",
    });
    expect(invalidRun.status).not.toBe(0);
    expect(await readFile(invalidShaFixture.runLog, "utf8")).toBe("");

    for (const form of ["corrupt", "mismatch", "symlink", "hardlink"] as const) {
      const fixture = await createTriggerFixture();
      const result = runHelper(fixture, "prepare-disable");
      expect(result.status, result.stderr).toBe(0);
      const manifestPath = manifestPathFrom(result.stdout);

      if (form === "corrupt") {
        await writeFile(manifestPath, "{not-json}\n");
      } else if (form === "symlink") {
        const originalPath = `${manifestPath}.original`;
        await rename(manifestPath, originalPath);
        await symlink(originalPath, manifestPath);
      } else if (form === "hardlink") {
        await link(manifestPath, `${manifestPath}.hardlink`);
      }

      const verified = runHelper(
        fixture,
        "verify-disabled",
        form === "mismatch"
          ? { TRIGGER_ID: "other-trigger-00000000-0000-0000-000000000000" }
          : {},
      );
      expect(verified.status, form).not.toBe(0);
      expect((await lstat(manifestPath)).nlink).toBeGreaterThanOrEqual(1);
    }
  }, 20_000);

  it("preserves the manifest when post-PATCH verification detects concurrent drift", async () => {
    const fixture = await createTriggerFixture();

    const prepared = runHelper(fixture, "prepare-disable", {
      DRIFT_AFTER_PATCH: "1",
    });
    const manifestPath = manifestPathFrom(prepared.stdout);

    expect(prepared.status).not.toBe(0);
    expect(prepared.stderr).toMatch(/drift|match/i);
    expect((await lstat(manifestPath)).isFile()).toBe(true);
  });

  it("rejects an arbitrary 40-hex SHA that is not the reviewed origin/main", async () => {
    const fixture = await createTriggerFixture();
    expect(runHelper(fixture, "prepare-disable").status).toBe(0);
    const arbitrarySha = fixture.mergedSha === "d".repeat(40)
      ? "e".repeat(40)
      : "d".repeat(40);

    const result = runHelper(fixture, "run-exact", {
      MERGED_SHA: arbitrarySha,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("origin/main");
    expect(await readFile(fixture.runLog, "utf8")).toBe("");
  });

  it("rejects malformed authoritative project-number discovery before trigger mutation", async () => {
    const fixture = await createTriggerFixture();

    const prepared = runHelper(fixture, "prepare-disable", {
      PROJECT_NUMBER_RESPONSE: "test-project",
    });

    expect(prepared.status).not.toBe(0);
    expect(prepared.stderr).toMatch(/project number/i);
    expect(await readFile(fixture.patchLog, "utf8")).toBe("");
    expect((await readTrigger(fixture)).disabled).toBeUndefined();
    await expect(lstat(fixture.manifestFile)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("accepts an LRO bound to the exact project ID and numeric Build resource", async () => {
    const fixture = await createTriggerFixture();
    expect(runHelper(fixture, "prepare-disable").status).toBe(0);

    const result = runHelper(fixture, "run-exact", {
      MERGED_SHA: fixture.mergedSha,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "operation_name=operations/build/test-project/operation-123",
    );
    expect(result.stdout).toContain("build_id=build-123");
  });

  it("rejects an LRO whose operation name belongs to a different project", async () => {
    const fixture = await createTriggerFixture();
    expect(runHelper(fixture, "prepare-disable").status).toBe(0);

    const result = runHelper(fixture, "run-exact", {
      MERGED_SHA: fixture.mergedSha,
      MISMATCH_OPERATION_PROJECT_ID: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/operation name|identity/i);
  });

  it("rejects an LRO Build whose canonical name has a different project number", async () => {
    const fixture = await createTriggerFixture();
    expect(runHelper(fixture, "prepare-disable").status).toBe(0);

    const result = runHelper(fixture, "run-exact", {
      MERGED_SHA: fixture.mergedSha,
      MISMATCH_BUILD_PROJECT_NUMBER: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/resource name|identity/i);
    const manifest = JSON.parse(
      await readFile(fixture.manifestFile, "utf8"),
    ) as { run_state: { status: string } };
    expect(manifest.run_state.status).toBe("intent");
    expect((await readTrigger(fixture)).disabled).toBe(true);
  });

  it("returns the durable accepted run without invoking the same SHA twice", async () => {
    const fixture = await createTriggerFixture();
    expect(runHelper(fixture, "prepare-disable").status).toBe(0);

    const first = runHelper(fixture, "run-exact", {
      MERGED_SHA: fixture.mergedSha,
    });
    const second = runHelper(fixture, "run-exact", {
      MERGED_SHA: fixture.mergedSha,
    });

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("existing_run=true");
    expect((await readFile(fixture.runLog, "utf8")).trim().split("\n")).toEqual([
      `RUN trigger=${triggerId} sha=${fixture.mergedSha}`,
    ]);
  });

  it("recovers one uniquely observable build after the trigger response is lost", async () => {
    const fixture = await createTriggerFixture();
    const prepared = runHelper(fixture, "prepare-disable");
    expect(prepared.status, prepared.stderr).toBe(0);
    const manifestPath = manifestPathFrom(prepared.stdout);

    const lost = runHelper(fixture, "run-exact", {
      LOSE_RUN_RESPONSE: "1",
      MERGED_SHA: fixture.mergedSha,
    });
    expect(lost.status).not.toBe(0);
    expect((await lstat(manifestPath)).isFile()).toBe(true);

    const recovered = runHelper(fixture, "run-exact", {
      MERGED_SHA: fixture.mergedSha,
    });
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(recovered.stdout).toContain("recovered_run=true");
    expect(recovered.stdout).toContain("build_id=build-123");
    expect((await readFile(fixture.runLog, "utf8")).trim().split("\n")).toEqual([
      `RUN trigger=${triggerId} sha=${fixture.mergedSha}`,
    ]);
    const restored = runHelper(fixture, "restore");
    expect(restored.status, restored.stderr).toBe(0);
    await expect(lstat(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects recovery when the matching Build name has a different project number", async () => {
    const fixture = await createTriggerFixture();
    expect(runHelper(fixture, "prepare-disable").status).toBe(0);
    const lost = runHelper(fixture, "run-exact", {
      LOSE_RUN_RESPONSE: "1",
      MERGED_SHA: fixture.mergedSha,
      MISMATCH_BUILD_PROJECT_NUMBER: "1",
    });
    expect(lost.status).not.toBe(0);

    const recovered = runHelper(fixture, "run-exact", {
      MERGED_SHA: fixture.mergedSha,
    });

    expect(recovered.status).not.toBe(0);
    expect(recovered.stderr).toMatch(/none|resource name|identity/i);
    const manifest = JSON.parse(
      await readFile(fixture.manifestFile, "utf8"),
    ) as { run_state: { status: string } };
    expect(manifest.run_state.status).toBe("intent");
  });

  it("blocks restore while an exact-SHA run intent remains unresolved", async () => {
    const fixture = await createTriggerFixture();
    expect(runHelper(fixture, "prepare-disable").status).toBe(0);
    const failed = runHelper(fixture, "run-exact", {
      DROP_RUN_BEFORE_ACCEPT: "1",
      LOSE_RUN_RESPONSE: "1",
      MERGED_SHA: fixture.mergedSha,
    });
    expect(failed.status).not.toBe(0);
    const patchLogBeforeRestore = await readFile(fixture.patchLog, "utf8");

    const restored = runHelper(fixture, "restore");

    expect(restored.status).not.toBe(0);
    expect(restored.stderr).toMatch(/intent|unresolved/i);
    expect(await readFile(fixture.patchLog, "utf8")).toBe(
      patchLogBeforeRestore,
    );
    expect((await readTrigger(fixture)).disabled).toBe(true);
    const manifest = JSON.parse(
      await readFile(fixture.manifestFile, "utf8"),
    ) as { run_state: { status: string } };
    expect(manifest.run_state.status).toBe("intent");
  });

  it("never duplicates an unresolved run intent when recovery sees zero or ambiguous builds", async () => {
    for (const recovery of ["none", "ambiguous"] as const) {
      const fixture = await createTriggerFixture();
      expect(runHelper(fixture, "prepare-disable").status).toBe(0);
      const failed = runHelper(fixture, "run-exact", {
        DROP_RUN_BEFORE_ACCEPT: recovery === "none" ? "1" : "0",
        MAKE_ACCEPT_AMBIGUOUS: recovery === "ambiguous" ? "1" : "0",
        LOSE_RUN_RESPONSE: "1",
        MERGED_SHA: fixture.mergedSha,
      });
      expect(failed.status).not.toBe(0);

      const retry = runHelper(fixture, "run-exact", {
        MERGED_SHA: fixture.mergedSha,
      });

      expect(retry.status, recovery).not.toBe(0);
      expect(retry.stderr).toMatch(/none|ambiguous|unique/i);
      expect((await readFile(fixture.runLog, "utf8")).trim().split("\n")).toEqual([
        `RUN trigger=${triggerId} sha=${fixture.mergedSha}`,
      ]);
      const manifest = JSON.parse(
        await readFile(manifestPathFrom(failed.stdout), "utf8"),
      ) as { run_state: { status: string } };
      expect(manifest.run_state.status).toBe("intent");
    }
  }, 15_000);

  it("derives its default persistent state directory from the private Git directory", async () => {
    const fixture = await createTriggerFixture();
    const copiedRepository = join(fixture.root, "copied-repository");
    const copiedScripts = join(copiedRepository, "scripts");
    await mkdir(copiedScripts, { recursive: true });
    const copiedHelper = join(copiedScripts, "manage-lifesnap-trigger.sh");
    await copyFile(fixture.helperPath, copiedHelper);
    await chmod(copiedHelper, 0o755);
    expect(spawnSync("git", ["init", "--quiet", copiedRepository]).status).toBe(0);
    const env: NodeJS.ProcessEnv = { ...fixture.env };
    delete env.TRIGGER_MANIFEST_FILE;

    const prepared = spawnSync(copiedHelper, ["prepare-disable"], {
      cwd: copiedRepository,
      encoding: "utf8",
      env,
    });
    const manifestPath = manifestPathFrom(prepared.stdout);

    expect(prepared.status, prepared.stderr).toBe(0);
    expect(manifestPath).toBe(
      join(copiedRepository, ".git/lifesnap-trigger-state/manifest.json"),
    );
    expect((await lstat(dirname(manifestPath))).mode & 0o777).toBe(0o700);
    expect(manifestPath).not.toContain(fixture.root + "/lifesnap-trigger-state-");
  });
});

async function createTriggerFixture(options: { disabled?: boolean } = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "lifesnap-trigger-contract-")),
  );
  temporaryDirectories.push(root);
  const binDirectory = join(root, "bin");
  await mkdir(binDirectory, { mode: 0o700 });
  const triggerState = join(root, "trigger.json");
  const patchLog = join(root, "patch.log");
  const runLog = join(root, "run.log");
  const buildsState = join(root, "builds.json");
  const stateDirectory = join(root, "trigger-state");
  const manifestFile = join(stateDirectory, "manifest.json");
  const fixtureRepository = join(root, "repository");
  const fixtureScripts = join(fixtureRepository, "scripts");
  const fixtureHelperPath = join(
    fixtureScripts,
    "manage-lifesnap-trigger.sh",
  );
  await mkdir(fixtureScripts, { recursive: true });
  await copyFile(helperPath, fixtureHelperPath);
  await chmod(fixtureHelperPath, 0o755);
  for (const args of [
    ["init", "--quiet", "--initial-branch=main", fixtureRepository],
    ["-C", fixtureRepository, "config", "user.name", "LifeSnap Test"],
    ["-C", fixtureRepository, "config", "user.email", "test@lifesnap.invalid"],
    ["-C", fixtureRepository, "add", "scripts/manage-lifesnap-trigger.sh"],
    ["-C", fixtureRepository, "commit", "--quiet", "-m", "fixture"],
    ["-C", fixtureRepository, "update-ref", "refs/remotes/origin/main", "HEAD"],
  ]) {
    const result = spawnSync("git", args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  }
  const mergedSha = spawnSync("git", ["rev-parse", "origin/main"], {
    cwd: fixtureRepository,
    encoding: "utf8",
  }).stdout.trim();
  await mkdir(stateDirectory, { mode: 0o700 });
  const trigger: Record<string, unknown> = {
    createTime: "2026-07-31T00:00:00Z",
    description: "main release trigger",
    filename: "cloudbuild.yaml",
    id: triggerId,
    name: "lifesnap-main",
    resourceName:
      `projects/test-project/locations/${triggerRegion}/triggers/${triggerId}`,
    repositoryEventConfig: {
      push: { branch: "^main$" },
      repository: "projects/test-project/locations/asia-northeast1/connections/github/repositories/lifesnap",
    },
    serviceAccount: "projects/test-project/serviceAccounts/cloud-build@test-project.iam.gserviceaccount.com",
    substitutions: { _DEPLOY_REGION: "asia-northeast1" },
  };
  if (options.disabled !== undefined) {
    trigger.disabled = options.disabled;
  }
  await writeFile(triggerState, `${JSON.stringify(trigger)}\n`);
  await writeFile(patchLog, "");
  await writeFile(runLog, "");
  await writeFile(buildsState, "[]\n");

  const curlPath = join(binDirectory, "curl");
  await writeFile(
    curlPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const { isDeepStrictEqual } = require("node:util");
let method = "GET";
let output = "";
let dataFile = "";
let url = "";
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--request") method = args[++index];
  else if (argument === "--output") output = args[++index];
  else if (argument === "--data-binary") dataFile = args[++index].replace(/^@/, "");
  else if (argument.startsWith("http")) url = argument;
}
const readState = () => JSON.parse(fs.readFileSync(process.env.TRIGGER_STATE, "utf8"));
const writeState = (state) => fs.writeFileSync(process.env.TRIGGER_STATE, JSON.stringify(state) + "\\n");
const respond = (value) => {
  const body = JSON.stringify(value) + "\\n";
  if (output) fs.writeFileSync(output, body);
  else process.stdout.write(body);
};
const withoutDisabled = (value) => {
  const copy = structuredClone(value);
  delete copy.disabled;
  return copy;
};
if (!url.includes("/v1/projects/test-project/locations/global/triggers/${triggerId}")) {
  process.stderr.write("unexpected trigger URL\\n");
  process.exit(22);
}
if (method === "POST" && url.endsWith(":run")) {
  const payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const sha = payload.source?.commitSha || "";
  if (payload.projectId !== "test-project" || payload.triggerId !== "${triggerId}") {
    process.stderr.write("invalid trigger run identity\\n");
    process.exit(22);
  }
  fs.appendFileSync(process.env.RUN_LOG, "RUN trigger=${triggerId} sha=" + sha + "\\n");
  const buildProjectNumber = process.env.MISMATCH_BUILD_PROJECT_NUMBER === "1"
    ? "999999999999"
    : "${projectNumber}";
  const build = {
    buildTriggerId: "${triggerId}",
    id: "build-123",
    name: "projects/" + buildProjectNumber + "/locations/global/builds/build-123",
    projectId: "test-project",
    status: "QUEUED",
    substitutions: { COMMIT_SHA: sha },
  };
  if (process.env.DROP_RUN_BEFORE_ACCEPT !== "1") {
    const builds = process.env.MAKE_ACCEPT_AMBIGUOUS === "1"
      ? [build, { ...build, id: "build-456", name: "projects/" + buildProjectNumber + "/locations/global/builds/build-456" }]
      : [build];
    fs.writeFileSync(process.env.BUILDS_STATE, JSON.stringify(builds) + "\\n");
  }
  if (process.env.LOSE_RUN_RESPONSE === "1") {
    process.stderr.write("injected lost trigger response\\n");
    process.exit(22);
  }
  respond({
    name: "operations/build/" +
      (process.env.MISMATCH_OPERATION_PROJECT_ID === "1" ? "other-project" : "test-project") +
      "/operation-123",
    metadata: {
      "@type": "type.googleapis.com/google.devtools.cloudbuild.v1.BuildOperationMetadata",
      build,
    },
  });
  process.exit(0);
}
if (method === "GET") {
  respond(readState());
  process.exit(0);
}
if (method !== "PATCH" || !url.endsWith("?updateMask=disabled")) {
  process.stderr.write("unexpected trigger request\\n");
  process.exit(22);
}
const state = readState();
const payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));
if (!isDeepStrictEqual(withoutDisabled(payload), withoutDisabled(state))) {
  process.stderr.write("PATCH was not a full current trigger representation\\n");
  process.exit(22);
}
const phase = state.disabled === true && payload.disabled === false ? "restore" : "disable";
if (process.env.FAIL_PATCH_MODE === phase) {
  process.stderr.write("injected " + phase + " PATCH failure\\n");
  process.exit(22);
}
if (payload.disabled === false && process.env.OMIT_FALSE_DISABLED === "1") {
  delete state.disabled;
} else {
  state.disabled = payload.disabled;
}
if (process.env.DRIFT_AFTER_PATCH === "1") state.description = "concurrent-edit";
writeState(state);
fs.appendFileSync(process.env.PATCH_LOG, "PATCH disabled=" + String(payload.disabled) + " full=true\\n");
respond(state);
`,
  );
  await chmod(curlPath, 0o700);

  const gcloudPath = join(binDirectory, "gcloud");
  await writeFile(
    gcloudPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "print-access-token") {
  process.stdout.write("fixture-access-token\\n");
  process.exit(0);
}
if (args[0] === "projects" && args[1] === "describe") {
  if (
    args[2] !== "test-project" ||
    !args.includes("--project=test-project") ||
    !args.includes("--format=value(projectNumber)")
  ) {
    process.stderr.write("invalid project-number discovery\\n");
    process.exit(1);
  }
  process.stdout.write((process.env.PROJECT_NUMBER_RESPONSE || "${projectNumber}") + "\\n");
  process.exit(0);
}
if (args[0] === "builds" && args[1] === "list") {
  process.stdout.write(fs.readFileSync(process.env.BUILDS_STATE, "utf8"));
  process.exit(0);
}
process.stderr.write("unexpected gcloud invocation\\n");
process.exit(1);
`,
  );
  await chmod(gcloudPath, 0o700);

  return {
    env: {
      ...process.env,
      BUILDS_STATE: buildsState,
      OMIT_FALSE_DISABLED: "1",
      PATCH_LOG: patchLog,
      PATH: `${binDirectory}:${process.env.PATH}`,
      PROJECT_ID: "test-project",
      RUN_LOG: runLog,
      TMPDIR: root,
      TRIGGER_ID: triggerId,
      TRIGGER_MANIFEST_FILE: manifestFile,
      TRIGGER_REGION: triggerRegion,
      TRIGGER_STATE: triggerState,
    },
    helperPath: fixtureHelperPath,
    patchLog,
    manifestFile,
    mergedSha,
    root,
    runLog,
    triggerState,
  };
}

function runHelper(
  fixture: TriggerFixture,
  mode: "prepare-disable" | "restore" | "run-exact" | "verify-disabled",
  overrides: Record<string, string> = {},
) {
  return spawnSync(fixture.helperPath, [mode], {
    cwd: fixture.root,
    encoding: "utf8",
    env: { ...fixture.env, ...overrides },
  });
}

async function readTrigger(fixture: TriggerFixture) {
  return JSON.parse(await readFile(fixture.triggerState, "utf8")) as Record<
    string,
    unknown
  >;
}

function manifestPathFrom(stdout: string) {
  const match = stdout.match(/^trigger_manifest=(.+)$/m);
  if (!match) throw new Error(`Missing trigger_manifest output: ${stdout}`);
  return match[1];
}
