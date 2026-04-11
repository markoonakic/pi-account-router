import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AccountRouterSettings {
  showFooter: boolean;
}

export const DEFAULT_ACCOUNT_ROUTER_SETTINGS: AccountRouterSettings = {
  showFooter: true,
};

function getAccountRouterSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "account-router.json");
}

function normalizeAccountRouterSettings(value: unknown): AccountRouterSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_ACCOUNT_ROUTER_SETTINGS };
  }

  const showFooter = "showFooter" in value && typeof value.showFooter === "boolean"
    ? value.showFooter
    : DEFAULT_ACCOUNT_ROUTER_SETTINGS.showFooter;

  return { showFooter };
}

export function loadAccountRouterSettings(cwd: string): AccountRouterSettings {
  const path = getAccountRouterSettingsPath(cwd);

  if (!existsSync(path)) {
    return { ...DEFAULT_ACCOUNT_ROUTER_SETTINGS };
  }

  try {
    return normalizeAccountRouterSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { ...DEFAULT_ACCOUNT_ROUTER_SETTINGS };
  }
}

export function saveAccountRouterSettings(cwd: string, settings: AccountRouterSettings): string {
  const path = getAccountRouterSettingsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalizeAccountRouterSettings(settings), null, 2)}\n`, "utf8");
  return path;
}
