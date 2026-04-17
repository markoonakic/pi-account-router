import { describe, expect, it, vi } from "vitest";

import {
  promptForAccountRename,
  showAccountDetailsMenu,
  showAddAccountFamilyPicker,
} from "../../src/ui/account-actions.js";

describe("account action helpers", () => {
  it("opens the add-family picker and returns the chosen family", async () => {
    const select = vi.fn().mockResolvedValue("ChatGPT Plus/Pro (Codex)");

    await expect(
      showAddAccountFamilyPicker({ select } as any, [
        { family: "openai-codex", displayName: "ChatGPT Plus/Pro (Codex)" },
        { family: "anthropic", displayName: "Anthropic (Claude Pro/Max)" },
      ]),
    ).resolves.toBe("openai-codex");

    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("esc back"),
      [
        "ChatGPT Plus/Pro (Codex)",
        "Anthropic (Claude Pro/Max)",
      ],
    );
  });

  it("shows details actions without a redundant close option and supports clear-label and provider-key actions", async () => {
    const clearLabelSelect = vi.fn().mockResolvedValue("Clear label");

    await expect(
      showAccountDetailsMenu({ select: clearLabelSelect } as any, {
        providerName: "openai-codex-2",
        displayName: "Work Pro Codex",
        summary: "5h left 80% · 7d left 65%",
        details: ["detail one"],
        hasLabel: true,
      }),
    ).resolves.toBe("clear-label");

    expect(clearLabelSelect).toHaveBeenCalledWith(
      expect.stringContaining("esc back"),
      ["Reauthenticate", "Clear label", "Remove account", "Show provider key"],
    );

    const providerKeySelect = vi.fn().mockResolvedValue("Show provider key");
    await expect(
      showAccountDetailsMenu({ select: providerKeySelect } as any, {
        providerName: "openai-codex-2",
        displayName: "Work Pro Codex",
        summary: "5h left 80% · 7d left 65%",
        details: ["detail one"],
      }),
    ).resolves.toBe("show-provider-key");
  });

  it("supports immediate rename, clear-label, and cancel distinctly", async () => {
    const renameInput = vi.fn().mockResolvedValue("Work Pro Codex");
    await expect(
      promptForAccountRename({ input: renameInput } as any, {
        providerName: "openai-codex-2",
        currentLabel: "Old Label",
      }),
    ).resolves.toBe("Work Pro Codex");
    expect(renameInput).toHaveBeenCalledWith("Rename openai-codex-2", "Old Label");

    const clearInput = vi.fn().mockResolvedValue("   ");
    await expect(
      promptForAccountRename({ input: clearInput } as any, {
        providerName: "openai-codex-2",
        currentLabel: "Old Label",
      }),
    ).resolves.toBeNull();

    const cancelInput = vi.fn().mockResolvedValue(undefined);
    await expect(
      promptForAccountRename({ input: cancelInput } as any, {
        providerName: "openai-codex-2",
        currentLabel: "Old Label",
      }),
    ).resolves.toBeUndefined();
  });
});
