import { describe, expect, it } from "vitest";

import { ADAPTERS } from "../../src/adapters/index.js";

describe("secondary adapters", () => {
  it("exports all supported provider families", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([
      "anthropic",
      "github-copilot",
      "google-antigravity",
      "google-gemini-cli",
      "openai-codex",
    ]);
  });

  it("keeps non-codex v1 failover and usage flags conservative", () => {
    expect(ADAPTERS["anthropic"].capabilities).toMatchObject({
      usage: false,
      silentFailover: false,
    });
    expect(ADAPTERS["github-copilot"].capabilities).toMatchObject({
      usage: false,
      silentFailover: false,
    });
    expect(ADAPTERS["google-gemini-cli"].capabilities).toMatchObject({
      usage: false,
      silentFailover: false,
    });
    expect(ADAPTERS["google-antigravity"].capabilities).toMatchObject({
      usage: false,
      silentFailover: false,
    });

    expect(ADAPTERS["anthropic"].classifyRetry).toBeUndefined();
    expect(ADAPTERS["github-copilot"].classifyRetry).toBeUndefined();
    expect(ADAPTERS["google-gemini-cli"].classifyRetry).toBeUndefined();
    expect(ADAPTERS["google-antigravity"].classifyRetry).toBeUndefined();
  });

  it("enables native login for the thin non-codex adapter families", () => {
    expect(ADAPTERS["anthropic"].capabilities.nativeLogin).toBe(true);
    expect(ADAPTERS["github-copilot"].capabilities.nativeLogin).toBe(true);
    expect(ADAPTERS["google-gemini-cli"].capabilities.nativeLogin).toBe(true);
    expect(ADAPTERS["google-antigravity"].capabilities.nativeLogin).toBe(true);
  });
});
