import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";

import type { ProviderFamilyId } from "../adapters/types.js";

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

export interface AddAccountFamilyOption {
  family: ProviderFamilyId;
  displayName: string;
}

export type AccountDetailsAction = "reauth" | "remove" | "show-provider-key" | undefined;

const ACCOUNT_DETAILS_OPTIONS = ["Reauthenticate", "Remove account", "Show provider key"] as const;

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
): Promise<string | null | undefined> {
  const placeholder = normalizeLabel(input.currentLabel);
  const value = placeholder === undefined
    ? await ui.input(`Rename ${input.providerName}`)
    : await ui.input(`Rename ${input.providerName}`, placeholder);

  if (value === undefined) {
    return undefined;
  }

  const normalized = normalizeLabel(value);
  return normalized === undefined ? null : normalized;
}

export async function showAccountDetailsMenu(
  ui: Pick<ExtensionUIContext, "select">,
  input: AccountDetailsMenuInput,
): Promise<AccountDetailsAction> {
  const title = firstNonEmpty(
    `${input.displayName} · esc back`,
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

  if (selection === "Show provider key") {
    return "show-provider-key";
  }

  return undefined;
}

export async function showAddAccountFamilyPicker(
  ui: Pick<ExtensionUIContext, "select">,
  families: readonly AddAccountFamilyOption[],
): Promise<ProviderFamilyId | undefined> {
  const labels = families.map((family) => family.displayName);
  const selection = await ui.select("Add account · esc back", labels);
  if (selection === undefined) {
    return undefined;
  }

  return families.find((family) => family.displayName === selection)?.family;
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
