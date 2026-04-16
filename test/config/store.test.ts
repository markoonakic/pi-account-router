import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAccountRouterSettingsStore,
  DEFAULT_ACCOUNT_ROUTER_SETTINGS,
} from "../../src/config/store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.splice(0, tempDirs.length);
});

describe("account router global settings store", () => {
  it("persists labels globally under the agent dir settings file", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-settings-"));
    tempDirs.push(agentDir);

    const store = createAccountRouterSettingsStore({ agentDir });

    expect(store.load()).toEqual(DEFAULT_ACCOUNT_ROUTER_SETTINGS);

    const path = store.save({
      ...DEFAULT_ACCOUNT_ROUTER_SETTINGS,
      labels: { "openai-codex-2": "Work Pro Codex" },
    });

    expect(path).toBe(join(agentDir, "settings.json"));
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      "pi-account-router": {
        showFooter: true,
        labels: { "openai-codex-2": "Work Pro Codex" },
      },
    });
    expect(store.load()).toEqual({
      showFooter: true,
      labels: { "openai-codex-2": "Work Pro Codex" },
    });
  });

  it("supports clearing labels without dropping other settings", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-account-router-settings-"));
    tempDirs.push(agentDir);

    const settingsPath = join(agentDir, "settings.json");
    writeFileSync(
      settingsPath,
      `${JSON.stringify({
        "other-extension": { enabled: true },
        "pi-account-router": {
          showFooter: false,
          labels: { "openai-codex-2": "Work Pro Codex" },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const store = createAccountRouterSettingsStore({ agentDir });
    store.save({
      showFooter: false,
      labels: {},
    });

    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      "other-extension": { enabled: true },
      "pi-account-router": {
        showFooter: false,
        labels: {},
      },
    });
    expect(store.load()).toEqual({ showFooter: false, labels: {} });
  });
});
