import { describe, expect, it } from "vitest";

import { discoverAccounts } from "../../src/auth/discovery.js";

describe("discoverAccounts", () => {
  it("discovers authenticated base and alias accounts for supported families and ignores unsupported providers", () => {
    const authStorage = {
      getAll() {
        return {
          openai: { type: "api_key" },
          "google-gemini-cli-2": { type: "oauth" },
          "openai-codex-2": { type: "oauth", expires: 4_102_444_800_000 },
          anthropic: { type: "api_key" },
          "google-antigravity": { type: "oauth" },
          "github-copilot-2": { type: "api_key" },
          "anthropic-2": { type: "oauth" },
          "github-copilot": { type: "oauth" },
          "openai-codex": { type: "api_key" },
          "google-antigravity-2": { type: "api_key" },
          "google-gemini-cli": { type: "api_key" },
        };
      },
    };

    expect(discoverAccounts(authStorage)).toEqual([
      {
        family: "anthropic",
        providerName: "anthropic",
        aliasIndex: 1,
        authenticated: true,
        authType: "apiKey",
      },
      {
        family: "anthropic",
        providerName: "anthropic-2",
        aliasIndex: 2,
        authenticated: true,
        authType: "oauth",
      },
      {
        family: "github-copilot",
        providerName: "github-copilot",
        aliasIndex: 1,
        authenticated: true,
        authType: "oauth",
      },
      {
        family: "github-copilot",
        providerName: "github-copilot-2",
        aliasIndex: 2,
        authenticated: true,
        authType: "apiKey",
      },
      {
        family: "google-antigravity",
        providerName: "google-antigravity",
        aliasIndex: 1,
        authenticated: true,
        authType: "oauth",
      },
      {
        family: "google-antigravity",
        providerName: "google-antigravity-2",
        aliasIndex: 2,
        authenticated: true,
        authType: "apiKey",
      },
      {
        family: "google-gemini-cli",
        providerName: "google-gemini-cli",
        aliasIndex: 1,
        authenticated: true,
        authType: "apiKey",
      },
      {
        family: "google-gemini-cli",
        providerName: "google-gemini-cli-2",
        aliasIndex: 2,
        authenticated: true,
        authType: "oauth",
      },
      {
        family: "openai-codex",
        providerName: "openai-codex",
        aliasIndex: 1,
        authenticated: true,
        authType: "apiKey",
      },
      {
        family: "openai-codex",
        providerName: "openai-codex-2",
        aliasIndex: 2,
        authenticated: true,
        authType: "oauth",
        accessExpiresAt: 4_102_444_800_000,
      },
    ]);
  });

  it("ignores null and undefined credentials instead of throwing", () => {
    const authStorage = {
      getAll() {
        return {
          anthropic: null,
          "anthropic-2": undefined,
          "openai-codex": { type: "oauth" },
        };
      },
    };

    expect(discoverAccounts(authStorage)).toEqual([
      {
        family: "openai-codex",
        providerName: "openai-codex",
        aliasIndex: 1,
        authenticated: true,
        authType: "oauth",
      },
    ]);
  });

  it("normalizes both api_key and apiKey credentials as apiKey auth", () => {
    const authStorage = {
      getAll() {
        return {
          anthropic: { type: "api_key" },
          "openai-codex": { type: "apiKey" },
        };
      },
    };

    expect(discoverAccounts(authStorage)).toEqual([
      {
        family: "anthropic",
        providerName: "anthropic",
        aliasIndex: 1,
        authenticated: true,
        authType: "apiKey",
      },
      {
        family: "openai-codex",
        providerName: "openai-codex",
        aliasIndex: 1,
        authenticated: true,
        authType: "apiKey",
      },
    ]);
  });
});
