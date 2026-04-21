import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { AccountSnapshot } from "../adapters/types.js";

export interface AccountRouterSnapshotCache {
  snapshots: Record<string, AccountSnapshot | undefined>;
}

export interface AccountRouterSnapshotCacheStoreOptions {
  agentDir?: string;
}

export type AccountRouterSnapshotCacheInput = Partial<AccountRouterSnapshotCache> | undefined;

export const DEFAULT_ACCOUNT_ROUTER_SNAPSHOT_CACHE: AccountRouterSnapshotCache = {
  snapshots: {},
};

function getDefaultAccountRouterSnapshotCache(): AccountRouterSnapshotCache {
  return {
    snapshots: {},
  };
}

function getAgentDir(explicitAgentDir?: string): string {
  return explicitAgentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function getCachePath(agentDir: string): string {
  return join(agentDir, "pi-account-router-cache.json");
}

function readCacheFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeIdentity(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeAccountSnapshot(value: unknown): AccountSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const snapshot = value as {
    summary?: unknown;
    details?: unknown;
    score?: unknown;
    badges?: unknown;
    identity?: unknown;
  };

  const details = Array.isArray(snapshot.details)
    ? snapshot.details.filter((detail): detail is string => typeof detail === "string" && detail.length > 0)
    : [];
  const badges = Array.isArray(snapshot.badges)
    ? Array.from(new Set(snapshot.badges.filter((badge): badge is string => typeof badge === "string" && badge.length > 0)))
    : [];
  const identity = normalizeIdentity(snapshot.identity);

  return {
    summary: typeof snapshot.summary === "string" ? snapshot.summary : "",
    details,
    score: typeof snapshot.score === "number" && Number.isFinite(snapshot.score) ? snapshot.score : 0,
    badges,
    ...(identity === undefined ? {} : { identity }),
  };
}

function normalizeAccountRouterSnapshotCache(value: unknown): AccountRouterSnapshotCache {
  if (!value || typeof value !== "object") {
    return getDefaultAccountRouterSnapshotCache();
  }

  const snapshotsSource = Object.hasOwn(value as object, "snapshots")
    && (value as { snapshots?: unknown }).snapshots
    && typeof (value as { snapshots?: unknown }).snapshots === "object"
    ? (value as { snapshots: Record<string, unknown> }).snapshots
    : {};

  const snapshots = Object.entries(snapshotsSource).reduce<Record<string, AccountSnapshot | undefined>>((result, [providerName, snapshot]) => {
    const normalizedSnapshot = normalizeAccountSnapshot(snapshot);
    if (normalizedSnapshot !== undefined) {
      result[providerName] = normalizedSnapshot;
    }
    return result;
  }, {});

  return { snapshots };
}

function resolveStoreOptions(
  optionsOrLegacyCwd?: AccountRouterSnapshotCacheStoreOptions | string,
): AccountRouterSnapshotCacheStoreOptions {
  if (typeof optionsOrLegacyCwd === "string") {
    return {};
  }

  return optionsOrLegacyCwd ?? {};
}

export function createAccountRouterSnapshotCacheStore(options: AccountRouterSnapshotCacheStoreOptions = {}) {
  const agentDir = getAgentDir(options.agentDir);
  const path = getCachePath(agentDir);

  return {
    path,
    load(): AccountRouterSnapshotCache {
      return normalizeAccountRouterSnapshotCache(readCacheFile(path));
    },
    save(cache: AccountRouterSnapshotCacheInput): string {
      const normalized = normalizeAccountRouterSnapshotCache(cache);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      return path;
    },
  };
}

export function loadAccountRouterSnapshotCache(
  optionsOrLegacyCwd?: AccountRouterSnapshotCacheStoreOptions | string,
): AccountRouterSnapshotCache {
  return createAccountRouterSnapshotCacheStore(resolveStoreOptions(optionsOrLegacyCwd)).load();
}

export function saveAccountRouterSnapshotCache(
  optionsOrLegacyCwd: AccountRouterSnapshotCacheStoreOptions | string | undefined,
  cache: AccountRouterSnapshotCacheInput,
): string {
  return createAccountRouterSnapshotCacheStore(resolveStoreOptions(optionsOrLegacyCwd)).save(cache);
}
