import { spawnSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
      schema_version: 1,
      trigger_id: "main-trigger",
      trigger_region: "asia-northeast1",
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

    const mergedSha = "b".repeat(40);
    const run = runHelper(fixture, "run-exact", { MERGED_SHA: mergedSha });
    expect(run.status, run.stderr).toBe(0);
    const runLog = await readFile(fixture.runLog, "utf8");
    expect(run.stdout, `stderr=${run.stderr} runLog=${runLog}`).toContain(
      `trigger_lifecycle=RUN build_id=build-123 commit=${mergedSha}`,
    );
    expect(runLog.trim().split("\n")).toEqual([
      `RUN trigger=main-trigger sha=${mergedSha}`,
    ]);
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
        form === "mismatch" ? { TRIGGER_ID: "other-trigger" } : {},
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
});

async function createTriggerFixture(options: { disabled?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "lifesnap-trigger-contract-"));
  temporaryDirectories.push(root);
  const binDirectory = join(root, "bin");
  await mkdir(binDirectory, { mode: 0o700 });
  const triggerState = join(root, "trigger.json");
  const patchLog = join(root, "patch.log");
  const runLog = join(root, "run.log");
  const trigger: Record<string, unknown> = {
    createTime: "2026-07-31T00:00:00Z",
    description: "main release trigger",
    filename: "cloudbuild.yaml",
    id: "main-trigger",
    name: "lifesnap-main",
    resourceName:
      "projects/test-project/locations/asia-northeast1/triggers/main-trigger",
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
if (!url.includes("/v1/projects/test-project/locations/asia-northeast1/triggers/main-trigger")) {
  process.stderr.write("unexpected trigger URL\\n");
  process.exit(22);
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
if (args[0] === "builds" && args[1] === "triggers" && args[2] === "run") {
  const trigger = args[3];
  const shaArgument = args.find((value) => value.startsWith("--sha="));
  const sha = shaArgument ? shaArgument.slice(6) : "";
  fs.appendFileSync(process.env.RUN_LOG, "RUN trigger=" + trigger + " sha=" + sha + "\\n");
  process.stdout.write(JSON.stringify({ id: "build-123", substitutions: { COMMIT_SHA: sha } }) + "\\n");
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
      OMIT_FALSE_DISABLED: "1",
      PATCH_LOG: patchLog,
      PATH: `${binDirectory}:${process.env.PATH}`,
      PROJECT_ID: "test-project",
      RUN_LOG: runLog,
      TMPDIR: root,
      TRIGGER_ID: "main-trigger",
      TRIGGER_REGION: "asia-northeast1",
      TRIGGER_STATE: triggerState,
    },
    patchLog,
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
  return spawnSync(helperPath, [mode], {
    cwd: repoRoot,
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
