import { describe, expect, it, vi } from "vitest";

import {
  promptForAccountRename,
  showAccountDetailsMenu,
  showAddAccountFamilyPicker,
} from "../../src/ui/account-actions.js";

describe("account action helpers", () => {
  it("opens the add-family picker with esc-back framing and returns the chosen family", async () => {
    const select = vi.fn().mockResolvedValue("ChatGPT Plus/Pro (Codex)");

    await expect(
      showAddAccountFamilyPicker({ select } as any, [
        { family: "openai-codex", displayName: "ChatGPT Plus/Pro (Codex)" },
        { family: "anthropic", displayName: "Anthropic (Claude Pro/Max)" },
      ]),
    ).resolves.toBe("openai-codex");

    expect(select).toHaveBeenCalledWith(
      "Add account · esc back",
      [
        "ChatGPT Plus/Pro (Codex)",
        "Anthropic (Claude Pro/Max)",
      ],
    );
  });

  it("shows details actions without a redundant close option and supports provider-key display", async () => {
    const select = vi.fn().mockResolvedValue("Show provider key");

    await expect(
      showAccountDetailsMenu({ select } as any, {
        providerName: "openai-codex-2",
        displayName: "Work Pro Codex",
        summary: "5h 80% left · 7d 65% left",
        details: ["detail one"],
      }),
    ).resolves.toBe("show-provider-key");

    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("esc back"),
      ["Reauthenticate", "Remove account", "Show provider key"],
    );
  });

  it("still supports the immediate rename prompt", async () => {
    const input = vi.fn().mockResolvedValue("Work Pro Codex");

    await expect(
      promptForAccountRename({ input } as any, {
        providerName: "openai-codex-2",
        currentLabel: "Old Label",
      }),
    ).resolves.toBe("Work Pro Codex");

    expect(input).toHaveBeenCalledWith("Rename openai-codex-2", "Old Label");
  });
});
