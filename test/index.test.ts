import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import installExtension from "../src/index.js";

describe("pi-account-router bootstrap", () => {
  it("registers the top-level account-router command with an account routing description", () => {
    const registerCommand = vi.fn();

    installExtension({ registerCommand } as unknown as ExtensionAPI);

    expect(registerCommand).toHaveBeenCalledTimes(1);
    expect(registerCommand).toHaveBeenCalledWith(
      "account-router",
      expect.objectContaining({
        description: expect.stringMatching(/account routing/i),
        handler: expect.any(Function),
      }),
    );
  });

  it("notifies when the account-router scaffold command runs", async () => {
    const registerCommand = vi.fn();
    const notify = vi.fn();

    installExtension({ registerCommand } as unknown as ExtensionAPI);

    const [, command] = registerCommand.mock.calls[0] as [
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ];

    await command.handler("", {
      hasUI: true,
      ui: { notify },
    } as unknown as ExtensionCommandContext);

    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/pi-account-router scaffold loaded/i), "info");
  });
});
