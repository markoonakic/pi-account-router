import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AuthCredential, AuthStorage } from "@mariozechner/pi-coding-agent";

const MULTICODEX_STORAGE_PATH = "/Users/marko/.pi/agent/codex-accounts.json";
const AUTH_SOURCE_PATH = "/Users/marko/.pi/agent/auth.json";
const AUTH_BACKUP_PREFIX = "/Users/marko/.pi/agent/auth.json.bak-";
const BASE_PROVIDER = "openai-codex";
const ALIAS_PREFIX = "openai-codex-";

interface MulticodexAccountRecord {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
}

interface MulticodexStorage {
  accounts: MulticodexAccountRecord[];
  activeEmail?: string;
}

export interface MulticodexImportPreviewRow {
  providerName: string;
  email: string;
  expiresAt: number;
  accountId?: string;
  isActiveSource: boolean;
}

export interface MulticodexImportPreview {
  sourcePath: string;
  accountCount: number;
  rows: MulticodexImportPreviewRow[];
}

export interface MulticodexImportResult extends MulticodexImportPreview {
  backupPath: string;
  removedProviders: string[];
  writtenProviders: string[];
}

export interface MulticodexImportOptions {
  storagePath?: string;
  authSourcePath?: string;
  authBackupPrefix?: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMulticodexAccountRecord(value: unknown): value is MulticodexAccountRecord {
  if (!isObjectRecord(value)) return false;
  return typeof value.email === "string"
    && typeof value.accessToken === "string"
    && typeof value.refreshToken === "string"
    && typeof value.expiresAt === "number";
}

function loadMulticodexStorage(storagePath = MULTICODEX_STORAGE_PATH): MulticodexStorage {
  if (!existsSync(storagePath)) {
    throw new Error(`Multicodex storage not found: ${storagePath}`);
  }

  const parsed = JSON.parse(readFileSync(storagePath, "utf8")) as unknown;
  if (!isObjectRecord(parsed) || !Array.isArray(parsed.accounts)) {
    throw new Error(`Invalid multicodex storage format: ${storagePath}`);
  }

  const accounts = parsed.accounts.filter(isMulticodexAccountRecord);
  if (accounts.length === 0) {
    throw new Error(`No importable multicodex accounts found in ${storagePath}`);
  }

  const activeEmail = typeof parsed.activeEmail === "string" ? parsed.activeEmail : undefined;
  return {
    accounts,
    ...(activeEmail === undefined ? {} : { activeEmail }),
  };
}

function sortAccountsForImport(storage: MulticodexStorage): MulticodexAccountRecord[] {
  const activeEmail = storage.activeEmail;
  return [...storage.accounts].sort((left, right) => {
    const leftActive = activeEmail !== undefined && left.email === activeEmail;
    const rightActive = activeEmail !== undefined && right.email === activeEmail;
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1;
    }

    const leftLastUsed = 0;
    const rightLastUsed = 0;
    if (leftLastUsed !== rightLastUsed) {
      return rightLastUsed - leftLastUsed;
    }

    return left.email.localeCompare(right.email);
  });
}

function buildProviderName(index: number): string {
  return index === 0 ? BASE_PROVIDER : `${ALIAS_PREFIX}${index + 1}`;
}

function buildPreview(storage: MulticodexStorage, sourcePath = MULTICODEX_STORAGE_PATH): MulticodexImportPreview {
  const ordered = sortAccountsForImport(storage);
  const rows = ordered.map((account, index) => ({
    providerName: buildProviderName(index),
    email: account.email,
    expiresAt: account.expiresAt,
    ...(account.accountId === undefined ? {} : { accountId: account.accountId }),
    isActiveSource: storage.activeEmail === account.email,
  }));

  return {
    sourcePath,
    accountCount: rows.length,
    rows,
  };
}

function buildCredential(account: MulticodexAccountRecord): AuthCredential {
  return {
    type: "oauth",
    access: account.accessToken,
    refresh: account.refreshToken,
    expires: account.expiresAt,
    ...(account.accountId ? { accountId: account.accountId } : {}),
  };
}

function collectExistingCodexProviders(authStorage: Pick<AuthStorage, "list">): string[] {
  return authStorage
    .list()
    .filter((providerName) => providerName === BASE_PROVIDER || providerName.startsWith(ALIAS_PREFIX))
    .sort((left, right) => left.localeCompare(right));
}

function createAuthBackupPath(timestamp: number, prefix: string): string {
  return `${prefix}${timestamp}`;
}

function createBackupIfPossible(timestamp: number, options: Required<Pick<MulticodexImportOptions, "authSourcePath" | "authBackupPrefix" | "storagePath">>): string {
  const authPath = options.authSourcePath;
  const backupPath = createAuthBackupPath(timestamp, options.authBackupPrefix);

  mkdirSync(dirname(backupPath), { recursive: true });
  if (existsSync(authPath)) {
    copyFileSync(authPath, backupPath);
  } else {
    mkdirSync(dirname(authPath), { recursive: true });
    copyFileSync(options.storagePath, backupPath);
  }
  return backupPath;
}

export function previewMulticodexImport(storagePath = MULTICODEX_STORAGE_PATH): MulticodexImportPreview {
  const storage = loadMulticodexStorage(storagePath);
  return buildPreview(storage, storagePath);
}

export function importMulticodexAccounts(
  authStorage: Pick<AuthStorage, "set" | "remove" | "list" | "reload">,
  options: MulticodexImportOptions = {},
): MulticodexImportResult {
  const resolvedOptions = {
    storagePath: options.storagePath ?? MULTICODEX_STORAGE_PATH,
    authSourcePath: options.authSourcePath ?? AUTH_SOURCE_PATH,
    authBackupPrefix: options.authBackupPrefix ?? AUTH_BACKUP_PREFIX,
  };
  const storage = loadMulticodexStorage(resolvedOptions.storagePath);
  const preview = buildPreview(storage, resolvedOptions.storagePath);
  const timestamp = Date.now();
  const backupPath = createBackupIfPossible(timestamp, resolvedOptions);

  const existingProviders = collectExistingCodexProviders(authStorage);
  const removedProviders = existingProviders.filter((providerName) => providerName !== BASE_PROVIDER);
  for (const providerName of removedProviders) {
    authStorage.remove(providerName);
  }

  const writtenProviders: string[] = [];
  const orderedAccounts = sortAccountsForImport(storage);
  orderedAccounts.forEach((account, index) => {
    const providerName = buildProviderName(index);
    authStorage.set(providerName, buildCredential(account));
    writtenProviders.push(providerName);
  });

  authStorage.reload();

  return {
    ...preview,
    backupPath,
    removedProviders,
    writtenProviders,
  };
}
