export interface AccountDisplayInput {
  providerName: string;
  providerDisplayName: string;
  label?: string;
  identity?: string;
  summary?: string;
  summaryUnavailableText?: string;
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
  return firstNonEmpty(input.label, input.identity, input.providerName, input.providerDisplayName)
    ?? input.providerDisplayName;
}

export function formatSecondaryGhostLine(input: AccountDisplayInput): string {
  const providerDisplayName = firstNonEmpty(input.providerDisplayName, input.providerName) ?? input.providerName;
  const summary = firstNonEmpty(input.summary);
  const fallbackSummary = firstNonEmpty(input.summaryUnavailableText);
  const detail = summary ?? fallbackSummary;

  return detail === undefined ? providerDisplayName : `${providerDisplayName} · ${detail}`;
}

export function formatFamilySectionHeader(input: FamilySectionHeaderInput): string {
  return `${input.providerDisplayName} · ${input.accountCount} accounts · ${input.activeCount} active`;
}
