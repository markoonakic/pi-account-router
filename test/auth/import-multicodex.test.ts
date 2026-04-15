import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { importMulticodexAccounts, previewMulticodexImport } from "../../src/auth/import-multicodex.js";

function createAuthStorage(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    set(provider: string, credential: unknown) {
      data.set(provider, credential);
    },
    remove(provider: string) {
      data.delete(provider);
    },
    list() {
      return [...data.keys()];
    },
    reload() {
      return undefined;
    },
    snapshot() {
      return Object.fromEntries(data.entries());
    },
  };
}

describe("multicodex importer", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.splice(0, tempDirs.length);
  });

  it("builds a dry-run preview using activeEmail as the base provider", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-account-router-import-"));
    tempDirs.push(dir);
    const sourcePath = join(dir, "codex-accounts.json");
    writeFileSync(sourcePath, JSON.stringify({
      activeEmail: "b@example.com",
      accounts: [
        { email: "a@example.com", accessToken: "a", refreshToken: "ra", expiresAt: 101 },
        { email: "b@example.com", accessToken: "b", refreshToken: "rb", expiresAt: 202, accountId: "acct-b" },
        { email: "c@example.com", accessToken: "c", refreshToken: "rc", expiresAt: 303 },
      ],
    }));

    const preview = previewMulticodexImport(sourcePath);
    expect(preview.rows).toEqual([
      {
        providerName: "openai-codex",
        email: "b@example.com",
        expiresAt: 202,
        accountId: "acct-b",
        isActiveSource: true,
      },
      {
        providerName: "openai-codex-2",
        email: "a@example.com",
        expiresAt: 101,
        accountId: undefined,
        isActiveSource: false,
      },
      {
        providerName: "openai-codex-3",
        email: "c@example.com",
        expiresAt: 303,
        accountId: undefined,
        isActiveSource: false,
      },
    ]);
  });

  it("imports codex accounts into auth storage aliases and removes stale codex aliases", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-account-router-import-"));
    tempDirs.push(dir);
    const sourcePath = join(dir, "codex-accounts.json");
    writeFileSync(sourcePath, JSON.stringify({
      activeEmail: "b@example.com",
      accounts: [
        { email: "a@example.com", accessToken: "a", refreshToken: "ra", expiresAt: 101 },
        { email: "b@example.com", accessToken: "b", refreshToken: "rb", expiresAt: 202, accountId: "acct-b" },
      ],
    }));

    const authStorage = createAuthStorage({
      anthropic: { type: "oauth", access: "anthropic-access" },
      "openai-codex": { type: "oauth", access: "old-base", refresh: "old", expires: 1 },
      "openai-codex-2": { type: "oauth", access: "old-two", refresh: "old", expires: 1 },
      "openai-codex-9": { type: "oauth", access: "old-nine", refresh: "old", expires: 1 },
    });

    const result = importMulticodexAccounts(authStorage as any, { storagePath: sourcePath });
    const snapshot = authStorage.snapshot() as Record<string, any>;

    expect(result.writtenProviders).toEqual(["openai-codex", "openai-codex-2"]);
    expect(result.removedProviders).toEqual(["openai-codex-2", "openai-codex-9"]);
    expect(snapshot.anthropic).toEqual({ type: "oauth", access: "anthropic-access" });
    expect(snapshot["openai-codex"]).toEqual({
      type: "oauth",
      access: "b",
      refresh: "rb",
      expires: 202,
      accountId: "acct-b",
    });
    expect(snapshot["openai-codex-2"]).toEqual({
      type: "oauth",
      access: "a",
      refresh: "ra",
      expires: 101,
    });
  });

  it("creates an auth backup before applying the import", () => {
    const authPath = "/Users/marko/.pi/agent/auth.json";
    const original = readFileSync(authPath, "utf8");
    const dir = mkdtempSync(join(tmpdir(), "pi-account-router-import-"));
    tempDirs.push(dir);
    const sourcePath = join(dir, "codex-accounts.json");
    writeFileSync(sourcePath, JSON.stringify({
      accounts: [
        { email: "a@example.com", accessToken: "a", refreshToken: "ra", expiresAt: 101 },
      ],
    }));

    const authStorage = createAuthStorage({});
    const result = importMulticodexAccounts(authStorage as any, {
      storagePath: sourcePath,
      authSourcePath: authPath,
      authBackupPrefix: `${authPath}.bak-`,
    });

    expect(result.backupPath).toContain(`${authPath}.bak-`);
    expect(readFileSync(result.backupPath, "utf8")).toBe(original);
  });
});
