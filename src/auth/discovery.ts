import type { ProviderFamilyId } from "../adapters/types.js";
import { getAliasIndex, getFamilyForProviderName } from "../providers/families.js";

export interface StoredCredential {
  type?: unknown;
}

export interface AuthStorageLike {
  getAll(): Record<string, StoredCredential | null | undefined>;
}

export interface DiscoveredAccount {
  family: ProviderFamilyId;
  providerName: string;
  aliasIndex: number;
  authenticated: boolean;
  authType: "oauth" | "apiKey";
}

function getDiscoveredAuthType(credential: StoredCredential | null | undefined): DiscoveredAccount["authType"] | undefined {
  if (!credential || typeof credential !== "object") {
    return undefined;
  }

  if (credential.type === "oauth") {
    return "oauth";
  }

  if (credential.type === "api_key" || credential.type === "apiKey") {
    return "apiKey";
  }

  return undefined;
}

export function discoverAccounts(authStorage: AuthStorageLike): DiscoveredAccount[] {
  return Object.entries(authStorage.getAll())
    .flatMap(([providerName, credential]) => {
      const family = getFamilyForProviderName(providerName);
      const authType = getDiscoveredAuthType(credential);

      if (family === undefined || authType === undefined) {
        return [];
      }

      return [
        {
          family,
          providerName,
          aliasIndex: getAliasIndex(providerName),
          authenticated: true,
          authType,
        },
      ];
    })
    .sort((left, right) => {
      const familyComparison = left.family.localeCompare(right.family);
      if (familyComparison !== 0) {
        return familyComparison;
      }

      return left.aliasIndex - right.aliasIndex;
    });
}
