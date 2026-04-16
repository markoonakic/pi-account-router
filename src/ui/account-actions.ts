import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";

export interface AccountRenamePromptInput {
  providerName: string;
  currentLabel?: string | undefined;
}

export interface AccountDetailsMenuInput {
  providerName: string;
  displayName: string;
  summary?: string | undefined;
  details?: string[] | undefined;
}

export interface AccountRemovalConfirmInput {
  providerName: string;
  displayName: string;
}

export type AccountDetailsAction = "reauth" | "remove" | undefined;

const ACCOUNT_DETAILS_OPTIONS = ["Reauthenticate", "Remove account", "Close"] as const;

function normalizeLabel(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function firstNonEmpty(...values: Array<string | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => value !== undefined && value.length > 0);
}

export async function promptForAccountRename(
  ui: Pick<ExtensionUIContext, "input">,
  input: AccountRenamePromptInput,
): Promise<string | undefined> {
  const placeholder = normalizeLabel(input.currentLabel);
  const value = placeholder === undefined
    ? await ui.input(`Rename ${input.providerName}`)
    : await ui.input(`Rename ${input.providerName}`, placeholder);

  return normalizeLabel(value);
}

export async function showAccountDetailsMenu(
  ui: Pick<ExtensionUIContext, "select">,
  input: AccountDetailsMenuInput,
): Promise<AccountDetailsAction> {
  const title = firstNonEmpty(
    input.displayName,
    `Provider key: ${input.providerName}`,
    input.summary,
    ...(input.details ?? []),
  ).join("\n");
  const selection = await ui.select(title, [...ACCOUNT_DETAILS_OPTIONS]);

  if (selection === "Reauthenticate") {
    return "reauth";
  }

  if (selection === "Remove account") {
    return "remove";
  }

  return undefined;
}

export async function confirmAccountRemoval(
  ui: Pick<ExtensionUIContext, "confirm">,
  input: AccountRemovalConfirmInput,
): Promise<boolean> {
  return ui.confirm(
    `Remove ${input.displayName}?`,
    `Remove ${input.displayName} (${input.providerName}) from account routing?`,
  );
}
