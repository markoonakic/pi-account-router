import { describe, expect, it } from "vitest";

import { buildAccountCatalog } from "../../src/accounts/catalog.js";

describe("buildAccountCatalog", () => {
  it("hydrates label-aware display fields from labels, identities, and provider display names", () => {
    const buildCatalog = buildAccountCatalog as unknown as (...args: unknown[]) => Array<Record<string, unknown>>;

    const entries = buildCatalog(
      [
        {
          family: "openai-codex",
          providerName: "openai-codex-2",
          aliasIndex: 2,
          authenticated: true,
          authType: "oauth",
        },
        {
          family: "openai-codex",
          providerName: "openai-codex-3",
          aliasIndex: 3,
          authenticated: true,
          authType: "oauth",
        },
        {
          family: "anthropic",
          providerName: "anthropic",
          aliasIndex: 1,
          authenticated: true,
          authType: "oauth",
        },
      ],
      {
        activeByFamily: {},
        pinnedByFamily: {},
        exhaustedUntilByProvider: {},
        needsReauthByProvider: {},
      },
      {
        "openai-codex-2": {
          summary: "5h left 80% | 7d left 65%",
          details: [],
          score: 145,
          badges: ["usage"],
          identity: "work@example.com",
        },
        "openai-codex-3": {
          summary: "5h left 55% | 7d left 42%",
          details: [],
          score: 97,
          badges: ["usage"],
          identity: "person@example.com",
        },
        anthropic: {
          summary: "",
          details: [],
          score: 0,
          badges: [],
        },
      },
      {
        "openai-codex-2": "Work Pro Codex",
      },
    );

    expect(entries[0]).toMatchObject({
      providerName: "openai-codex-2",
      label: "Work Pro Codex",
      identity: "work@example.com",
      providerDisplayName: "ChatGPT Plus/Pro (Codex)",
      displayName: "Work Pro Codex",
      secondaryText: "ChatGPT Plus/Pro (Codex) · 5h left 80% | 7d left 65%",
    });

    expect(entries[1]).toMatchObject({
      providerName: "openai-codex-3",
      identity: "person@example.com",
      providerDisplayName: "ChatGPT Plus/Pro (Codex)",
      displayName: "person@example.com",
      secondaryText: "ChatGPT Plus/Pro (Codex) · 5h left 55% | 7d left 42%",
    });
    expect(entries[1]).not.toHaveProperty("label");

    expect(entries[2]).toMatchObject({
      providerName: "anthropic",
      providerDisplayName: "Anthropic (Claude Pro/Max)",
      displayName: "Anthropic (Claude Pro/Max)",
      secondaryText: "Anthropic (Claude Pro/Max)",
    });
    expect(entries[2]).not.toHaveProperty("label");
    expect(entries[2]).not.toHaveProperty("identity");
  });
});
