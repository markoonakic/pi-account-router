export interface FooterAccountEntry {
  providerName: string;
  displayName?: string;
  active: boolean;
  pinned: boolean;
  exhausted: boolean;
  needsReauth: boolean;
  summary?: string;
  badges: string[];
}

export interface FooterSummaryEntry {
  providerName: string;
  summary?: string;
  exhausted: boolean;
  needsReauth: boolean;
}

export function formatAccountRow(entry: FooterAccountEntry): string {
  const stateBits = [
    entry.active ? "active" : undefined,
    entry.pinned ? "pinned" : undefined,
    entry.exhausted ? "cooldown" : undefined,
    entry.needsReauth ? "reauth" : undefined,
    ...entry.badges.map((badge) => `[${badge}]`),
  ].filter((value): value is string => value !== undefined);

  return [entry.providerName, entry.displayName, stateBits.join(" "), entry.summary]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" — ");
}

export function renderFooter(entry?: FooterSummaryEntry): string | undefined {
  if (entry === undefined) {
    return undefined;
  }

  const parts = [entry.providerName];

  if (entry.summary) {
    parts.push(entry.summary);
  }

  if (entry.exhausted) {
    parts.push("cooldown");
  }

  if (entry.needsReauth) {
    parts.push("reauth");
  }

  return parts.join(" | ");
}
