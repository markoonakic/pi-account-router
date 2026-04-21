export interface AccountPanelHotkeyModel {
  key: string;
  label: string;
}

export interface AccountPanelHeaderModel {
  title: string;
  hotkeys: readonly AccountPanelHotkeyModel[];
  ghostSummary: string;
}

export interface AccountPanelRowInput {
  accountId: string;
  primaryText: string;
  secondaryText: string;
}

export interface AccountPanelSectionInput {
  familyId: string;
  familyTitle: string;
  rows: readonly AccountPanelRowInput[];
}

export interface BuildAccountPanelShellInput {
  ghostSummary: string;
  sections: readonly AccountPanelSectionInput[];
}

export interface AccountPanelRowModel {
  accountId: string;
  lines: {
    primary: string;
    secondary: string;
  };
}

export interface AccountPanelFamilySectionModel {
  familyId: string;
  familyTitle: string;
  rows: readonly AccountPanelRowModel[];
}

export interface AccountPanelShellModel {
  header: AccountPanelHeaderModel;
  sections: readonly AccountPanelFamilySectionModel[];
}

export const ACCOUNT_PANEL_TITLE = "Account Router";

export const ACCOUNT_PANEL_HOTKEYS = [
  { key: "enter", label: "toggle pin" },
  { key: "r", label: "rename" },
  { key: "u", label: "refresh" },
  { key: "a", label: "add" },
  { key: "d", label: "details" },
  { key: "backspace", label: "remove" },
  { key: "esc", label: "close" },
] as const satisfies readonly AccountPanelHotkeyModel[];

export function buildAccountPanelShell(input: BuildAccountPanelShellInput): AccountPanelShellModel {
  return {
    header: {
      title: ACCOUNT_PANEL_TITLE,
      hotkeys: ACCOUNT_PANEL_HOTKEYS.map((hotkey) => ({ ...hotkey })),
      ghostSummary: input.ghostSummary,
    },
    sections: input.sections.map((section) => ({
      familyId: section.familyId,
      familyTitle: section.familyTitle,
      rows: section.rows.map((row) => ({
        accountId: row.accountId,
        lines: {
          primary: row.primaryText,
          secondary: row.secondaryText,
        },
      })),
    })),
  };
}
