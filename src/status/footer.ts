import { formatSecondaryGhostLine } from "../ui/account-display.js";

export interface FooterAccountEntry {
  providerName: string;
  providerDisplayName?: string;
  label?: string;
  identity?: string;
  displayName?: string;
  secondaryText?: string;
  active: boolean;
  pinned: boolean;
  exhausted: boolean;
  needsReauth: boolean;
  summary: string | undefined;
  badges: string[];
}

export interface FooterSummaryEntry {
  providerName: string;
  providerDisplayName?: string;
  label?: string;
  identity?: string;
  displayName?: string;
  secondaryText?: string;
  summary: string | undefined;
  exhausted: boolean;
  needsReauth: boolean;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function getPrimaryName(entry: Pick<FooterSummaryEntry, "providerName" | "providerDisplayName" | "label" | "identity" | "displayName">): string {
  return firstNonEmpty(entry.displayName, entry.label, entry.identity, entry.providerDisplayName, entry.providerName)
    ?? entry.providerName;
}

function getSecondaryText(
  entry: Pick<FooterSummaryEntry, "providerName" | "providerDisplayName" | "label" | "identity" | "displayName" | "secondaryText" | "summary">,
): string | undefined {
  const providerDisplayName = firstNonEmpty(entry.providerDisplayName);
  const primaryName = getPrimaryName(entry);
  const explicitSecondary = firstNonEmpty(entry.secondaryText);

  if (explicitSecondary !== undefined) {
    if (providerDisplayName !== undefined && primaryName === providerDisplayName) {
      if (explicitSecondary === providerDisplayName) {
        return undefined;
      }

      const prefix = `${providerDisplayName} · `;
      return explicitSecondary.startsWith(prefix) ? explicitSecondary.slice(prefix.length) : explicitSecondary;
    }

    return explicitSecondary;
  }

  const summary = firstNonEmpty(entry.summary);
  if (summary === undefined) {
    return undefined;
  }

  if (providerDisplayName === undefined) {
    return summary;
  }

  return primaryName === providerDisplayName
    ? summary
    : formatSecondaryGhostLine({
        providerName: entry.providerName,
        providerDisplayName,
        summary,
      });
}

export function formatAccountRow(entry: FooterAccountEntry): string {
  const stateBits = [
    entry.active ? "active" : undefined,
    entry.pinned ? "pinned" : undefined,
    entry.exhausted ? "cooldown" : undefined,
    entry.needsReauth ? "reauth" : undefined,
  ].filter((value): value is string => value !== undefined);

  return [getPrimaryName(entry), getSecondaryText(entry), stateBits.join(" ")]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" — ");
}

export function renderFooter(entry?: FooterSummaryEntry): string | undefined {
  if (entry === undefined) {
    return undefined;
  }

  const parts = [getPrimaryName(entry)];
  const secondaryText = getSecondaryText(entry);

  if (secondaryText) {
    parts.push(secondaryText);
  }

  if (entry.exhausted) {
    parts.push("cooldown");
  }

  if (entry.needsReauth) {
    parts.push("reauth");
  }

  return parts.join(" | ");
}
