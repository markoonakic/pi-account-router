import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { discoverAccounts } from "../../src/auth/discovery.js";
import { cloneLiveRegistryModels } from "../../src/models/live-registry.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.splice(0, tempDirs.length);
});

describe("temp agent dir integration", () => {
  it("discovers alias auth entries from a temp auth.json", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-account-router-auth-"));
    tempDirs.push(root);

    const authPath = join(root, "auth.json");
    writeFileSync(
      authPath,
      `${JSON.stringify({
        "openai-codex": { type: "oauth", access: "a", refresh: "r1", expires: 4_102_444_800_000 },
        "openai-codex-2": { type: "oauth", access: "b", refresh: "r2", expires: 4_102_444_800_000 },
      }, null, 2)}\n`,
      "utf8",
    );

    const authStorage = AuthStorage.create(authPath);
    expect(discoverAccounts(authStorage).map((account) => account.providerName)).toEqual([
      "openai-codex",
      "openai-codex-2",
    ]);
  });

  it("preserves live model override metadata when cloning alias models", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-account-router-models-"));
    tempDirs.push(root);

    const modelsJsonPath = join(root, "models.json");
    writeFileSync(
      modelsJsonPath,
      `${JSON.stringify({
        providers: {
          "openai-codex": {
            modelOverrides: {
              "gpt-5.4": {
                contextWindow: 1_050_000,
              },
            },
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const modelRegistry = ModelRegistry.create(AuthStorage.inMemory(), modelsJsonPath);
    const clonedModels = await cloneLiveRegistryModels(modelRegistry, "openai-codex", "openai-codex-2");
    const clonedModel = clonedModels.find((model) => model.id === "gpt-5.4");

    expect(clonedModel?.contextWindow).toBe(1_050_000);
  });
});
