import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installAccountRouter } from "../../src/install.js";
import { discoverAccounts } from "../../src/auth/discovery.js";
import { importMulticodexAccounts } from "../../src/auth/import-multicodex.js";
import { AuthStorage } from "../../node_modules/@mariozechner/pi-coding-agent/dist/core/auth-storage.js";

function createModel(provider: string, id = "gpt-5.4") {
  return {
    provider,
    id,
    name: id,
    api: "openai-codex-responses" as const,
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_050_000,
    maxTokens: 32_768,
  };
}

describe("temporary multicodex import flow", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.splice(0, tempDirs.length);
  });

  it("imports live multicodex accounts into a temporary auth store and the router registers aliases from them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })));
    const dir = mkdtempSync(join(tmpdir(), "pi-account-router-migration-"));
    tempDirs.push(dir);

    const authPath = join(dir, "auth.json");
    const backupPrefix = join(dir, "auth.json.bak-");
    cpSync("/Users/marko/.pi/agent/auth.json", authPath);

    const authStorage = AuthStorage.create(authPath);
    const result = importMulticodexAccounts(authStorage, {
      authSourcePath: authPath,
      authBackupPrefix: backupPrefix,
    });

    expect(result.accountCount).toBeGreaterThan(1);
    expect(result.writtenProviders[0]).toBe("openai-codex");
    expect(result.writtenProviders).toContain("openai-codex-2");
    expect(readFileSync(result.backupPath, "utf8").length).toBeGreaterThan(0);

    const discovered = discoverAccounts(authStorage).filter((entry) => entry.family === "openai-codex");
    expect(discovered.map((entry) => entry.providerName)).toEqual(result.writtenProviders);

    const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void> | void>();
    const registerCommand = vi.fn();
    const registerProvider = vi.fn();

    installAccountRouter({
      registerCommand,
      registerProvider,
      on: vi.fn((event: string, handler: (event: unknown, ctx: any) => Promise<void> | void) => {
        handlers.set(event, handler);
      }),
    } as any);

    const ctx = {
      cwd: process.cwd(),
      modelRegistry: {
        authStorage,
        refresh: vi.fn(),
        getAll: () => [createModel("openai-codex")],
        find: vi.fn((provider: string, id: string) => ({ ...createModel(provider), id })),
        getApiKeyAndHeaders: vi.fn(async () => ({ ok: true })),
      },
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
      model: createModel("openai-codex"),
      hasUI: true,
    };

    await handlers.get("session_start")?.({}, ctx);

    const registeredCodexProviders = registerProvider.mock.calls
      .map((call) => call[0])
      .filter((providerName: string) => providerName === "openai-codex" || providerName.startsWith("openai-codex-"));

    expect(registeredCodexProviders).toEqual(result.writtenProviders);
    vi.unstubAllGlobals();
  }, 15000);
});
