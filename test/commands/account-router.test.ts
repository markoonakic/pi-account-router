import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { registerAccountRouterCommand, type AccountRouterCommandHost } from "../../src/commands/account-router.js";
import { formatAccountRow, renderFooter } from "../../src/status/footer.js";

function createHost(overrides: Partial<AccountRouterCommandHost> = {}): AccountRouterCommandHost {
  return {
    listAccounts: vi.fn().mockResolvedValue([]),
    addAccount: vi.fn().mockResolvedValue(undefined),
    pinAccount: vi.fn(),
    unpin: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    renameAccount: vi.fn().mockResolvedValue(undefined),
    showAccountDetails: vi.fn().mockResolvedValue(undefined),
    removeAccount: vi.fn().mockResolvedValue(undefined),
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
      custom: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };

  return context as unknown as ExtensionCommandContext;
}

describe("account-router status rendering", () => {
  it("formats account rows with human-first names plus provider display and usage context", () => {
    expect(
      formatAccountRow({
        providerName: "openai-codex-2",
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        displayName: "Work Pro Codex",
        label: "Work Pro Codex",
        identity: "work@example.com",
        active: true,
        pinned: true,
        exhausted: false,
        needsReauth: false,
        summary: "5h left 80% | 7d left 65%",
        badges: ["usage", "silent failover"],
      }),
    ).toBe("Work Pro Codex — ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65% — active pinned");
  });

  it("renders a compact footer with the human-first name instead of the raw provider key", () => {
    expect(
      renderFooter({
        providerName: "openai-codex-2",
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        displayName: "Work Pro Codex",
        summary: "5h left 80% | 7d left 65%",
        exhausted: false,
        needsReauth: false,
      }),
    ).toBe("Work Pro Codex | ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65%");
  });

  it("adds cooldown and reauth markers to the compact footer while keeping the provider display human-first", () => {
    expect(
      renderFooter({
        providerName: "openai-codex-2",
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        displayName: "person@example.com",
        summary: "5h left 80% | 7d left 65%",
        exhausted: true,
        needsReauth: true,
      }),
    ).toBe("person@example.com | ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65% | cooldown | reauth");
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
    await command.handler("add toString", ctx);
    await command.handler("use", ctx);
    await command.handler("import multicodex", ctx);
    await command.handler("unknown", ctx);

    expect(host.addAccount).not.toHaveBeenCalled();
    expect(host.pinAccount).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /account-router add <family>", "error");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Unknown provider family: not-a-family", "error");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Unknown provider family: toString", "error");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /account-router use <provider-or-alias>", "error");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Unknown subcommand: import", "error");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Unknown subcommand: unknown", "error");
  });

  it("uses a custom account panel for the default interactive path", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65%",
      badges: ["usage"],
    };
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext();

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(ctx.ui.custom).toHaveBeenCalledWith(expect.any(Function));
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("re-renders the custom panel when the viewport width changes", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: true,
      pinned: true,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65% | extra usage summary for resize coverage",
      badges: ["usage", "silent failover"],
    };
    let panelFactory:
      | ((...args: any[]) => any)
      | undefined;
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
        custom: vi.fn().mockImplementation(async (factory) => {
          panelFactory = factory as (...args: any[]) => any;
          return undefined;
        }),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(panelFactory).toBeTypeOf("function");

    if (panelFactory === undefined) {
      return;
    }

    const component = await panelFactory(
      { requestRender: vi.fn() },
      {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      },
      {},
      vi.fn(),
    );

    const wideLines = component.render(80);
    const narrowLines = component.render(20);

    expect(narrowLines).not.toEqual(wideLines);
  });

  it("opens a family picker when add is requested from the custom panel", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      providerDisplayName: "ChatGPT Plus/Pro (Codex)",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65%",
      badges: ["usage"],
    };
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn().mockResolvedValue("ChatGPT Plus/Pro (Codex)"),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "add" })
          .mockResolvedValueOnce(undefined),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(ctx.ui.select).toHaveBeenCalledWith(
      "Add account · esc back",
      expect.arrayContaining(["ChatGPT Plus/Pro (Codex)", "Anthropic (Claude Pro/Max)"]),
    );
    expect(host.addAccount).toHaveBeenCalledWith("openai-codex", ctx);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(2);
  });

  it("treats add-family picker cancellation as back and returns to the root panel", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      providerDisplayName: "ChatGPT Plus/Pro (Codex)",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65%",
      badges: ["usage"],
    };
    const listAccounts = vi.fn().mockResolvedValue([account]);
    const host = createHost({ listAccounts });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn().mockResolvedValue(undefined),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "add" })
          .mockResolvedValueOnce(undefined),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(host.addAccount).not.toHaveBeenCalled();
    expect(listAccounts).toHaveBeenCalledTimes(2);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(2);
  });

  it("reloads the custom panel from listAccounts when refresh is requested", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65%",
      badges: ["usage"],
    };
    const listAccounts = vi.fn().mockResolvedValue([account]);
    const host = createHost({ listAccounts });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "refresh" })
          .mockResolvedValueOnce(undefined),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(host.refresh).not.toHaveBeenCalled();
    expect(listAccounts).toHaveBeenCalledTimes(2);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(2);
  });

  it("dispatches a rename action from the custom panel to the host", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65%",
      badges: ["usage"],
    };
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "rename", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(host.renameAccount).toHaveBeenCalledWith("openai-codex-2", ctx);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(2);
  });

  it("dispatches a details action from the custom panel to the host", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65%",
      badges: ["usage"],
    };
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "details", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(host.showAccountDetails).toHaveBeenCalledWith("openai-codex-2", ctx);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(2);
  });

  it("dispatches a remove action from the custom panel to the host", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65%",
      badges: ["usage"],
    };
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
        custom: vi.fn()
          .mockResolvedValueOnce({ action: "remove", providerName: "openai-codex-2" })
          .mockResolvedValueOnce(undefined),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(host.removeAccount).toHaveBeenCalledWith("openai-codex-2", ctx);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(2);
  });

  it("pins the selected account when the custom panel returns a select action", async () => {
    const registerCommand = vi.fn();
    const account = {
      providerName: "openai-codex-2",
      displayName: "ChatGPT Codex #2",
      active: false,
      pinned: false,
      exhausted: false,
      needsReauth: false,
      summary: "5h left 80% | 7d left 65%",
      badges: ["usage"],
    };
    const host = createHost({
      listAccounts: vi.fn().mockResolvedValue([account]),
    });
    const ctx = createContext({
      ui: {
        notify: vi.fn(),
        select: vi.fn(),
        custom: vi.fn().mockResolvedValue({
          action: "select",
          providerName: "openai-codex-2",
        }),
      } as any,
    });

    registerAccountRouterCommand({ registerCommand } as any, host);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", ctx);

    expect(ctx.ui.custom).toHaveBeenCalledWith(expect.any(Function));
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
      summary: "5h left 80% | 7d left 65%",
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
