export interface AccountDisplayInput {
  providerName: string;
  providerDisplayName: string;
  label?: string;
  identity?: string;
  summary?: string;
}

export interface FamilySectionHeaderInput {
  providerDisplayName: string;
  accountCount: number;
  activeCount: number;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

export function resolvePrimaryAccountName(input: AccountDisplayInput): string {
  return firstNonEmpty(input.label, input.identity, input.providerDisplayName) ?? input.providerDisplayName;
}

export function formatSecondaryGhostLine(input: AccountDisplayInput): string {
  const summary = firstNonEmpty(input.summary);
  return summary === undefined ? input.providerDisplayName.trim() : `${input.providerDisplayName.trim()} · ${summary}`;
}

export function formatFamilySectionHeader(input: FamilySectionHeaderInput): string {
  return `${input.providerDisplayName} · ${input.accountCount} accounts · ${input.activeCount} active`;
}
