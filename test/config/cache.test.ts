import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAccountRouterSnapshotCacheStore,
  DEFAULT_ACCOUNT_ROUTER_SNAPSHOT_CACHE,
} from "../../src/config/cache.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.splice(0, tempDirs.length);
});

describe("account router snapshot cache store", () => {
  it("persists last known snapshots under the agent dir cache file", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-cache-"));
    tempDirs.push(agentDir);

    const store = createAccountRouterSnapshotCacheStore({ agentDir });

    expect(store.load()).toEqual(DEFAULT_ACCOUNT_ROUTER_SNAPSHOT_CACHE);

    const path = store.save({
      snapshots: {
        "openai-codex-2": {
          identity: "work@example.com",
          summary: "5h left 80% | 7d left 65%",
          details: ["chatgpt-pro", "5h left 80%", "7d left 65%"],
          score: 145,
          badges: ["usage", "native login"],
        },
      },
    });

    expect(path).toBe(join(agentDir, "pi-account-router-cache.json"));
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      snapshots: {
        "openai-codex-2": {
          identity: "work@example.com",
          summary: "5h left 80% | 7d left 65%",
          details: ["chatgpt-pro", "5h left 80%", "7d left 65%"],
          score: 145,
          badges: ["usage", "native login"],
        },
      },
    });
    expect(store.load()).toEqual({
      snapshots: {
        "openai-codex-2": {
          identity: "work@example.com",
          summary: "5h left 80% | 7d left 65%",
          details: ["chatgpt-pro", "5h left 80%", "7d left 65%"],
          score: 145,
          badges: ["usage", "native login"],
        },
      },
    });
  });

  it("drops invalid cache entries while keeping valid snapshot data", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-cache-"));
    tempDirs.push(agentDir);

    const cachePath = join(agentDir, "pi-account-router-cache.json");
    writeFileSync(
      cachePath,
      `${JSON.stringify({
        snapshots: {
          "openai-codex-2": {
            identity: "  work@example.com  ",
            summary: "5h left 80% | 7d left 65%",
            details: ["chatgpt-pro", 123, "7d left 65%"],
            score: 145,
            badges: ["usage", null, "usage", "native login"],
          },
          broken: null,
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = createAccountRouterSnapshotCacheStore({ agentDir });

    expect(store.load()).toEqual({
      snapshots: {
        "openai-codex-2": {
          identity: "work@example.com",
          summary: "5h left 80% | 7d left 65%",
          details: ["chatgpt-pro", "7d left 65%"],
          score: 145,
          badges: ["usage", "native login"],
        },
      },
    });
  });
});
