import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AccountRouterSettings {
  showFooter: boolean;
  labels: Record<string, string>;
}

export interface AccountRouterSettingsStoreOptions {
  agentDir?: string;
}

export type AccountRouterSettingsInput = Partial<AccountRouterSettings> | undefined;

export const DEFAULT_ACCOUNT_ROUTER_SETTINGS: AccountRouterSettings = {
  showFooter: true,
  labels: {},
};

const SETTINGS_KEY = "pi-account-router";

function getDefaultAccountRouterSettings(): AccountRouterSettings {
  return {
    showFooter: DEFAULT_ACCOUNT_ROUTER_SETTINGS.showFooter,
    labels: { ...DEFAULT_ACCOUNT_ROUTER_SETTINGS.labels },
  };
}

function getAgentDir(explicitAgentDir?: string): string {
  return explicitAgentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function getSettingsPath(agentDir: string): string {
  return join(agentDir, "settings.json");
}

function readSettingsFile(path: string): Record<string, unknown> {
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

function normalizeAccountRouterSettings(value: unknown): AccountRouterSettings {
  if (!value || typeof value !== "object") {
    return getDefaultAccountRouterSettings();
  }

  const settings = value as { showFooter?: unknown; labels?: unknown };
  const showFooter = Object.hasOwn(settings, "showFooter") && typeof settings.showFooter === "boolean"
    ? settings.showFooter
    : DEFAULT_ACCOUNT_ROUTER_SETTINGS.showFooter;

  const labelsSource = Object.hasOwn(settings, "labels") && settings.labels && typeof settings.labels === "object"
    ? settings.labels as Record<string, unknown>
    : {};
  const labels = Object.entries(labelsSource).reduce<Record<string, string>>((result, [providerName, label]) => {
    if (typeof label !== "string") {
      return result;
    }

    const normalizedLabel = label.trim();
    if (normalizedLabel.length > 0) {
      result[providerName] = normalizedLabel;
    }

    return result;
  }, {});

  return {
    showFooter,
    labels,
  };
}

function resolveStoreOptions(optionsOrLegacyCwd?: AccountRouterSettingsStoreOptions | string): AccountRouterSettingsStoreOptions {
  if (typeof optionsOrLegacyCwd === "string") {
    return {};
  }

  return optionsOrLegacyCwd ?? {};
}

export function createAccountRouterSettingsStore(options: AccountRouterSettingsStoreOptions = {}) {
  const agentDir = getAgentDir(options.agentDir);
  const path = getSettingsPath(agentDir);

  return {
    path,
    load(): AccountRouterSettings {
      const file = readSettingsFile(path);
      return normalizeAccountRouterSettings(file[SETTINGS_KEY]);
    },
    save(settings: AccountRouterSettingsInput): string {
      const file = readSettingsFile(path);
      file[SETTINGS_KEY] = normalizeAccountRouterSettings(settings);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      return path;
    },
  };
}

export function loadAccountRouterSettings(
  optionsOrLegacyCwd?: AccountRouterSettingsStoreOptions | string,
): AccountRouterSettings {
  return createAccountRouterSettingsStore(resolveStoreOptions(optionsOrLegacyCwd)).load();
}

export function saveAccountRouterSettings(
  optionsOrLegacyCwd: AccountRouterSettingsStoreOptions | string | undefined,
  settings: AccountRouterSettingsInput,
): string {
  return createAccountRouterSettingsStore(resolveStoreOptions(optionsOrLegacyCwd)).save(settings);
}
