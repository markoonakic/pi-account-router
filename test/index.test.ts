import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import installExtension from "../src/index.js";

describe("pi-account-router bootstrap", () => {
  it("registers the top-level account-router command", () => {
    const registerCommand = vi.fn();

    installExtension({ registerCommand } as unknown as ExtensionAPI);

    expect(registerCommand).toHaveBeenCalledTimes(1);
    expect(registerCommand).toHaveBeenCalledWith(
      "account-router",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
  });
});
