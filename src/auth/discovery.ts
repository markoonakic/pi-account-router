import type { ProviderFamilyId } from "../adapters/types.js";
import { getAliasIndex, getFamilyForProviderName } from "../providers/families.js";

export interface StoredCredential {
  type: string;
}

export interface AuthStorageLike {
  getAll(): Record<string, StoredCredential>;
}

export interface DiscoveredAccount {
  family: ProviderFamilyId;
  providerName: string;
  aliasIndex: number;
  authenticated: boolean;
  authType: "oauth" | "apiKey";
}

function getDiscoveredAuthType(credential: StoredCredential): DiscoveredAccount["authType"] | undefined {
  if (credential.type === "oauth") {
    return "oauth";
  }

  if (credential.type === "api_key") {
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
