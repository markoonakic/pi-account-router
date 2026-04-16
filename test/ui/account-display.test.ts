import { describe, expect, it } from "vitest";

const ACCOUNT_DISPLAY_MODULE = "../../src/ui/account-display.js";

async function loadAccountDisplayModule(): Promise<Record<string, unknown>> {
  try {
    return await import(ACCOUNT_DISPLAY_MODULE) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe("account display helpers", () => {
  it("prefers the friendly label, then identity, then provider display name for the primary line", async () => {
    const accountDisplay = await loadAccountDisplayModule();

    expect(accountDisplay.resolvePrimaryAccountName).toBeTypeOf("function");

    if (typeof accountDisplay.resolvePrimaryAccountName !== "function") {
      return;
    }

    expect(
      accountDisplay.resolvePrimaryAccountName({
        providerName: "openai-codex-2",
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        label: "Personal Pro",
        identity: "person@example.com",
      }),
    ).toBe("Personal Pro");

    expect(
      accountDisplay.resolvePrimaryAccountName({
        providerName: "openai-codex-2",
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        label: "   ",
        identity: "person@example.com",
      }),
    ).toBe("person@example.com");

    expect(
      accountDisplay.resolvePrimaryAccountName({
        providerName: "openai-codex-2",
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        identity: "   ",
      }),
    ).toBe("ChatGPT Plus/Pro (Codex)");
  });

  it("formats the secondary ghost line from the provider display name and usage summary without raw aliases", async () => {
    const accountDisplay = await loadAccountDisplayModule();

    expect(accountDisplay.formatSecondaryGhostLine).toBeTypeOf("function");

    if (typeof accountDisplay.formatSecondaryGhostLine !== "function") {
      return;
    }

    expect(
      accountDisplay.formatSecondaryGhostLine({
        providerName: "openai-codex-2",
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        summary: "5h 80% | 7d 65%",
      }),
    ).toBe("ChatGPT Plus/Pro (Codex) · 5h 80% | 7d 65%");

    expect(
      accountDisplay.formatSecondaryGhostLine({
        providerName: "openai-codex-2",
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        summary: "   ",
      }),
    ).toBe("ChatGPT Plus/Pro (Codex)");
  });

  it("formats family headers with the display name, total accounts, and active accounts", async () => {
    const accountDisplay = await loadAccountDisplayModule();

    expect(accountDisplay.formatFamilySectionHeader).toBeTypeOf("function");

    if (typeof accountDisplay.formatFamilySectionHeader !== "function") {
      return;
    }

    expect(
      accountDisplay.formatFamilySectionHeader({
        providerDisplayName: "ChatGPT Plus/Pro (Codex)",
        accountCount: 3,
        activeCount: 2,
      }),
    ).toBe("ChatGPT Plus/Pro (Codex) · 3 accounts · 2 active");
  });
});
