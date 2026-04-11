import { describe, expect, it } from "vitest";

import {
  FAMILY_DEFS,
  getAliasIndex,
  getFamilyForProviderName,
  getNextAliasProviderName,
  getProviderSortKey,
} from "../../src/providers/families.js";

describe("provider family metadata", () => {
  it("matches base and alias provider names", () => {
    expect(getFamilyForProviderName("openai-codex")).toBe("openai-codex");
    expect(getFamilyForProviderName("openai-codex-3")).toBe("openai-codex");
    expect(getFamilyForProviderName("anthropic-2")).toBe("anthropic");
    expect(getFamilyForProviderName("openai-codex-foo")).toBeUndefined();
    expect(getFamilyForProviderName("openai")).toBeUndefined();
  });

  it("computes alias indexes for base and alias providers", () => {
    expect(getAliasIndex("openai-codex")).toBe(1);
    expect(getAliasIndex("openai-codex-4")).toBe(4);
    expect(getAliasIndex("google-gemini-cli-2")).toBe(2);
  });

  it("allocates aliases starting at index 2 and skips used numbers", () => {
    expect(
      getNextAliasProviderName("openai-codex", ["openai-codex", "openai-codex-2", "openai-codex-4"]),
    ).toBe("openai-codex-3");
  });

  it("publishes v1 capability defaults", () => {
    expect(FAMILY_DEFS["openai-codex"].capabilities.silentFailover).toBe(true);
    expect(FAMILY_DEFS["anthropic"].capabilities.silentFailover).toBe(false);
    expect(FAMILY_DEFS["google-gemini-cli"].capabilities.nativeLogin).toBe(true);
  });

  it("sorts base providers before aliases", () => {
    expect(getProviderSortKey("openai-codex")).toBeLessThan(getProviderSortKey("openai-codex-2"));
  });

  it("sorts providers deterministically across families and aliases", () => {
    const providerNames = ["openai-codex-2", "anthropic", "openai-codex", "anthropic-2"];

    expect([...providerNames].sort((left, right) => getProviderSortKey(left) - getProviderSortKey(right))).toEqual([
      "anthropic",
      "anthropic-2",
      "openai-codex",
      "openai-codex-2",
    ]);
  });
});
