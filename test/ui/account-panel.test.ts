import { describe, expect, it } from "vitest";

const ACCOUNT_PANEL_MODULE = "../../src/ui/account-panel.js";

async function loadAccountPanelModule(): Promise<Record<string, unknown>> {
  try {
    return await import(ACCOUNT_PANEL_MODULE) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe("account panel shell", () => {
  it("builds the approved panel header with title, ordered hotkeys, and ghost summary", async () => {
    const accountPanel = await loadAccountPanelModule();

    expect(accountPanel.buildAccountPanelShell).toBeTypeOf("function");

    if (typeof accountPanel.buildAccountPanelShell !== "function") {
      return;
    }

    const shell = accountPanel.buildAccountPanelShell({
      ghostSummary: "2 active · 1 needs refresh",
      sections: [
        {
          familyId: "openai-codex",
          familyTitle: "ChatGPT Plus/Pro (Codex)",
          rows: [
            {
              accountId: "personal-pro",
              primaryText: "Personal Pro",
              secondaryText: "person@example.com · Active",
            },
          ],
        },
      ],
    });

    expect(shell.header).toEqual({
      title: "Account Router",
      hotkeys: [
        { key: "enter", label: "pin" },
        { key: "r", label: "rename" },
        { key: "u", label: "refresh" },
        { key: "a", label: "add" },
        { key: "d", label: "details" },
        { key: "backspace", label: "remove" },
        { key: "esc", label: "close" },
      ],
      ghostSummary: "2 active · 1 needs refresh",
    });
  });

  it("keeps provider family sections with two-line row payloads ready for future rendering", async () => {
    const accountPanel = await loadAccountPanelModule();

    expect(accountPanel.buildAccountPanelShell).toBeTypeOf("function");

    if (typeof accountPanel.buildAccountPanelShell !== "function") {
      return;
    }

    const shell = accountPanel.buildAccountPanelShell({
      ghostSummary: "3 accounts across 2 families",
      sections: [
        {
          familyId: "openai-codex",
          familyTitle: "ChatGPT Plus/Pro (Codex)",
          rows: [
            {
              accountId: "personal-pro",
              primaryText: "Personal Pro",
              secondaryText: "person@example.com · Active",
            },
            {
              accountId: "work-pro",
              primaryText: "Work Pro",
              secondaryText: "work@example.com · Refresh required",
            },
          ],
        },
        {
          familyId: "anthropic",
          familyTitle: "Claude Pro",
          rows: [
            {
              accountId: "side-project",
              primaryText: "Side Project",
              secondaryText: "side@example.com · Standby",
            },
          ],
        },
      ],
    });

    expect(shell.sections).toEqual([
      {
        familyId: "openai-codex",
        familyTitle: "ChatGPT Plus/Pro (Codex)",
        rows: [
          {
            accountId: "personal-pro",
            lines: {
              primary: "Personal Pro",
              secondary: "person@example.com · Active",
            },
          },
          {
            accountId: "work-pro",
            lines: {
              primary: "Work Pro",
              secondary: "work@example.com · Refresh required",
            },
          },
        ],
      },
      {
        familyId: "anthropic",
        familyTitle: "Claude Pro",
        rows: [
          {
            accountId: "side-project",
            lines: {
              primary: "Side Project",
              secondary: "side@example.com · Standby",
            },
          },
        ],
      },
    ]);
  });
});
