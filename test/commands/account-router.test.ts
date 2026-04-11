import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAccountRouterSettings, saveAccountRouterSettings } from "../../src/config/store.js";
import { registerAccountRouterCommand, type AccountRouterCommandHost } from "../../src/commands/account-router.js";
import { formatAccountRow, renderFooter } from "../../src/status/footer.js";

function createHost(overrides: Partial<AccountRouterCommandHost> = {}): AccountRouterCommandHost {
  return {
    listAccounts: vi.fn().mockResolvedValue([]),
    addAccount: vi.fn().mockResolvedValue(undefined),
    pinAccount: vi.fn(),
    unpin: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    statusText: vi.fn().mockReturnValue("status ok"),
    debugText: vi.fn().mockReturnValue("debug ok"),
    ...overrides,
  };
}

function createContext(overrides: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
  const context = {
    hasUI: true,
    ui: {
      notify: vi.fn(),
      select: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };

  return context as unknown as ExtensionCommandContext;
}

describe("account-router status rendering", () => {
  it("formats account rows with badges and state", () => {
    expect(
      formatAccountRow({
        providerName: "openai-codex-2",
        displayName: "ChatGPT Codex #2",
        active: true,
        pinned: true,
        exhausted: false,
        needsReauth: false,
        summary: "5h 80% | 7d 65%",
        badges: ["usage", "silent failover"],
      }),
    ).toBe("openai-codex-2 — ChatGPT Codex #2 — active pinned [usage] [silent failover] — 5h 80% | 7d 65%");
  });

  it("renders a compact footer for the active account", () => {
    expect(
      renderFooter({
        providerName: "openai-codex-2",
        summary: "5h 80% | 7d 65%",
        exhausted: false,
        needsReauth: false,
      }),
    ).toBe("openai-codex-2 | 5h 80% | 7d 65%");
  });

  it("adds cooldown and reauth markers to the compact footer when needed", () => {
    expect(
      renderFooter({
        providerName: "openai-codex-2",
        summary: "5h 80% | 7d 65%",
        exhausted: true,
        needsReauth: true,
      }),
    ).toBe("openai-codex-2 | 5h 80% | 7d 65% | cooldown | reauth");
  });
});

describe("account-router settings store", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.splice(0, tempDirs.length);
  });

  it("returns the default settings when the project file is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-account-router-settings-"));
    tempDirs.push(cwd);

    expect(loadAccountRouterSettings(cwd)).toEqual({ showFooter: true });
  });

  it("persists showFooter in .pi/account-router.json", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-account-router-settings-"));
    tempDirs.push(cwd);

    const path = saveAccountRouterSettings(cwd, { showFooter: false });

    expect(path).toBe(join(cwd, ".pi", "account-router.json"));
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ showFooter: false });
    expect(loadAccountRouterSettings(cwd)).toEqual({ showFooter: false });
  });
});

describe("account-router command surface", () => {
  it("registers /account-router and supports status output", async () => {
    const registerCommand = vi.fn();
    const pi = { registerCommand };
    const host = createHost();

    registerAccountRouterCommand(pi as any, host);

    expect(registerCommand).toHaveBeenCalledWith(
      "account-router",
      expect.objectContaining({
        description: expect.stringMatching(/routed provider accounts/i),
        handler: expect.any(Function),
      }),
    );

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];
    const ctx = createContext();

    await command.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("status ok", "info");
  });

  it("supports debug, add, use, unpin, and refresh subcommands", async () => {
    const registerCommand = vi.fn();
    const host = createHost();

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];
    const ctx = createContext();

    await command.handler("debug", ctx);
    await command.handler("add openai-codex", ctx);
    await command.handler("use openai-codex-2", ctx);
    await command.handler("unpin openai-codex", ctx);
    await command.handler("refresh", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("debug ok", "info");
    expect(host.addAccount).toHaveBeenCalledWith("openai-codex", ctx);
    expect(host.pinAccount).toHaveBeenCalledWith("openai-codex-2");
    expect(host.unpin).toHaveBeenCalledWith("openai-codex");
    expect(host.refresh).toHaveBeenCalledWith(ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Pinned openai-codex-2", "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Cleared manual pin", "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Account router refreshed", "info");
  });

  it("reports invalid subcommands and missing/invalid family arguments instead of falling through", async () => {
    const registerCommand = vi.fn();
    const host = createHost();
    const ctx = createContext();

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("add", ctx);
    await command.handler("add not-a-family", ctx);
    await command.handler("use", ctx);
    await command.handler("unknown", ctx);

    expect(host.addAccount).not.toHaveBeenCalled();
    expect(host.pinAccount).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /account-router add <family>", "error");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Unknown provider family: not-a-family", "error");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /account-router use <provider-or-alias>", "error");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Unknown subcommand: unknown", "error");
  });

  it("opens an interactive list when UI is available and pins the selected account row", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h 80% | 7d 65%",
      badges: ["usage"],
    };
    const row = formatAccountRow(account);
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn().mockResolvedValue(row),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(ctx.ui.select).toHaveBeenCalledWith("Account Router", ["status", "refresh", row]);
    expect(host.pinAccount).toHaveBeenCalledWith("openai-codex-2");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Pinned openai-codex-2", "info");
  });

  it("falls back to text output when UI is unavailable", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h 80% | 7d 65%",
      badges: ["usage"],
    };
    const row = formatAccountRow(account);
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext({ hasUI: false });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(row, "info");
  });
});
