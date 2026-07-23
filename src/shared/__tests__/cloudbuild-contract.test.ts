import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const configPath = new URL("../../../cloudbuild.yaml", import.meta.url);

describe("Cloud Build release contract", () => {
  it("gates an immutable commit image before promoting its exact candidate revision", async () => {
    const config = await readFile(configPath, "utf8");

    const orderedGates = [
      "npm ci",
      "npm test",
      "npm run lint",
      "npm run build",
      "docker build",
      "docker push",
      "--no-traffic",
      "/health",
      "/privacy",
      "/api/extract",
      "update-traffic",
      "--to-revisions",
    ];

    let previousIndex = -1;
    for (const gate of orderedGates) {
      const currentIndex = config.indexOf(gate);
      expect(currentIndex, `${gate} must appear after the preceding release gate`).toBeGreaterThan(
        previousIndex,
      );
      previousIndex = currentIndex;
    }

    expect(config).toContain("apps-cloud-build@zhang23-23.iam.gserviceaccount.com");
    expect(config).toContain("logging: CLOUD_LOGGING_ONLY");
    expect(config).toContain(
      "$_LIFESNAP_AR_REPOSITORY/$_IMAGE_NAME:$COMMIT_SHA",
    );
    expect(config).toContain("_LIFESNAP_AR_REPOSITORY: apps");
    expect(config).toContain("test-assets/service_notice.png");
    expect(config).toContain("source-commit=${COMMIT_SHA}");
    expect(config).toContain("managed-by=cloud-build");
    expect(config).toContain("product=lifesnap-action");
    expect(config).toContain("environment=production");
    expect(config).toContain(
      "--remove-labels=commit-sha,gcb-build-id,gcb-trigger-id,gcb-trigger-region",
    );
  });

  it("preserves the existing runtime identity and secret injection", async () => {
    const config = await readFile(configPath, "utf8");

    expect(config).not.toContain("--set-env-vars");
    expect(config).not.toContain("--clear-env-vars");
    expect(config).not.toContain("--set-secrets");
    expect(config).not.toContain("--clear-secrets");
    expect(config).not.toContain("GEMINI_API_KEY=");
  });
});
