import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import installExtension from "../src/index.js";

function createModelRegistry() {
  return {
    authStorage: {
      getAll: () => ({}),
      get: () => undefined,
    },
    refresh: vi.fn(),
    getAll: () => [],
    find: vi.fn(),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: false })),
  };
}

describe("pi-account-router bootstrap", () => {
  it("registers the top-level account-router command with an account routing description", () => {
    const registerCommand = vi.fn();
    const on = vi.fn();

    installExtension({ registerCommand, on } as unknown as ExtensionAPI);

    expect(registerCommand).toHaveBeenCalledTimes(1);
    expect(registerCommand).toHaveBeenCalledWith(
      "account-router",
      expect.objectContaining({
        description: expect.stringMatching(/routed provider accounts/i),
        handler: expect.any(Function),
      }),
    );
  });

  it("routes the default interactive flow through the shared installed command surface", async () => {
    const registerCommand = vi.fn();
    const on = vi.fn();
    const custom = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();

    installExtension({ registerCommand, on } as unknown as ExtensionAPI);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", {
      cwd: process.cwd(),
      hasUI: true,
      modelRegistry: createModelRegistry(),
      ui: { custom, notify, setStatus: vi.fn() },
    } as unknown as ExtensionCommandContext);

    expect(custom).toHaveBeenCalledWith(expect.any(Function));
    expect(notify).not.toHaveBeenCalledWith(expect.stringMatching(/unknown subcommand/i), "error");
  });

  it("uses the shared command fallback when no UI is available", async () => {
    const registerCommand = vi.fn();
    const on = vi.fn();
    const notify = vi.fn();

    installExtension({ registerCommand, on } as unknown as ExtensionAPI);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", {
      cwd: process.cwd(),
      hasUI: false,
      modelRegistry: createModelRegistry(),
      ui: { notify, setStatus: vi.fn() },
    } as unknown as ExtensionCommandContext);

    expect(notify).toHaveBeenCalledWith("No routed accounts discovered", "info");
  });
});
