import type { AdapterCapabilities, ProviderFamilyId } from "../adapters/types.js";

export interface FamilyDefinition {
  id: ProviderFamilyId;
  displayName: string;
  capabilities: AdapterCapabilities;
}

export const FAMILY_DEFS: Record<ProviderFamilyId, FamilyDefinition> = {
  "openai-codex": {
    id: "openai-codex",
    displayName: "ChatGPT Plus/Pro (Codex)",
    capabilities: {
      usage: true,
      silentFailover: true,
      nativeLogin: true,
      reauth: true,
      experimental: false,
    },
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic (Claude Pro/Max)",
    capabilities: {
      usage: false,
      silentFailover: false,
      nativeLogin: true,
      reauth: true,
      experimental: false,
    },
  },
  "github-copilot": {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    capabilities: {
      usage: false,
      silentFailover: false,
      nativeLogin: true,
      reauth: true,
      experimental: false,
    },
  },
  "google-gemini-cli": {
    id: "google-gemini-cli",
    displayName: "Google Cloud Code Assist",
    capabilities: {
      usage: false,
      silentFailover: false,
      nativeLogin: true,
      reauth: true,
      experimental: true,
    },
  },
  "google-antigravity": {
    id: "google-antigravity",
    displayName: "Antigravity",
    capabilities: {
      usage: false,
      silentFailover: false,
      nativeLogin: true,
      reauth: true,
      experimental: true,
    },
  },
};

function isAliasForFamily(providerName: string, family: ProviderFamilyId): boolean {
  if (providerName === family) {
    return true;
  }

  if (!providerName.startsWith(`${family}-`)) {
    return false;
  }

  const suffix = providerName.slice(family.length + 1);
  return /^\d+$/.test(suffix);
}

export function getFamilyForProviderName(providerName: string): ProviderFamilyId | undefined {
  for (const family of Object.keys(FAMILY_DEFS) as ProviderFamilyId[]) {
    if (isAliasForFamily(providerName, family)) {
      return family;
    }
  }

  return undefined;
}

export function getAliasIndex(providerName: string): number {
  const match = providerName.match(/-(\d+)$/);
  return match ? Number.parseInt(match[1] ?? "", 10) : 1;
}

export function getNextAliasProviderName(family: ProviderFamilyId, existingProviderNames: string[]): string {
  const usedIndexes = new Set(
    existingProviderNames
      .filter((providerName) => getFamilyForProviderName(providerName) === family)
      .map(getAliasIndex),
  );

  let nextIndex = 2;
  while (usedIndexes.has(nextIndex)) {
    nextIndex += 1;
  }

  return `${family}-${nextIndex}`;
}

export function getProviderSortKey(providerName: string): number {
  return getAliasIndex(providerName);
}
