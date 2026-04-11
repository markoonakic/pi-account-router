import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai/oauth", () => ({
  loginOpenAICodex: vi.fn(),
  refreshOpenAICodexToken: vi.fn(),
}));

import { loginOpenAICodex, refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";

import { classifyCodexRetry } from "../../src/adapters/codex/classify.js";
import { createCodexAdapter } from "../../src/adapters/codex/index.js";
import { buildCodexAccountSnapshot, parseCodexUsage } from "../../src/adapters/codex/usage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("codex adapter", () => {
  it("parses 5h and 7d usage windows by window length and returns remaining percentages", () => {
    const snapshot = parseCodexUsage({
      plan_type: "chatgpt-pro",
      rate_limit: {
        primary_window: { used_percent: 35, limit_window_seconds: 604_800, reset_at: 2_000_604_800 },
        secondary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_at: 2_000_000_000 },
      },
    });

    expect(snapshot).toEqual({
      planType: "chatgpt-pro",
      fiveHourLeft: 80,
      weeklyLeft: 65,
      resetAtFiveHour: 2_000_000_000,
      resetAtWeekly: 2_000_604_800,
    });
  });

  it("builds a codex account snapshot with summary, score, and badges", () => {
    const parsed = parseCodexUsage({
      plan_type: "chatgpt-pro",
      rate_limit: {
        primary_window: { used_percent: 35, limit_window_seconds: 604_800, reset_at: 2_000_604_800 },
        secondary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_at: 2_000_000_000 },
      },
    });

    expect(buildCodexAccountSnapshot(parsed)).toEqual({
      summary: "chatgpt-pro | 5h 80% | 7d 65%",
      details: ["chatgpt-pro", "5h 80%", "7d 65%"],
      score: 145,
      badges: ["usage", "silent failover", "native login"],
    });
  });

  it("classifies quota, auth, and other failures", () => {
    expect(classifyCodexRetry("429 rate limit exceeded")).toMatchObject({
      action: "retry",
      reason: "quota",
      clearPin: true,
      cooldownUntil: expect.any(Number),
    });
    expect(classifyCodexRetry("token refresh failed")).toEqual({
      action: "retry",
      reason: "auth",
      clearPin: true,
    });
    expect(classifyCodexRetry("unexpected server crash")).toEqual({
      action: "surface",
      reason: "other",
    });
  });

  it("fetches codex usage snapshots through the adapter when auth is available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        plan_type: "chatgpt-pro",
        rate_limit: {
          primary_window: { used_percent: 35, limit_window_seconds: 604_800, reset_at: 2_000_604_800 },
          secondary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_at: 2_000_000_000 },
        },
      }),
    })));

    const adapter = createCodexAdapter();
    const snapshot = await adapter.createSnapshot?.({
      providerName: "openai-codex-2",
      auth: { access: "access-token", accountId: "acct_123" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          "chatgpt-account-id": "acct_123",
        }),
      }),
    );
    expect(snapshot).toEqual({
      summary: "chatgpt-pro | 5h 80% | 7d 65%",
      details: ["chatgpt-pro", "5h 80%", "7d 65%"],
      score: 145,
      badges: ["usage", "silent failover", "native login"],
    });
  });

  it("degrades codex snapshots gracefully when auth is missing or fetch fails", async () => {
    const adapter = createCodexAdapter();

    await expect(adapter.createSnapshot?.({ providerName: "openai-codex-2" })).resolves.toEqual({
      summary: "",
      details: [],
      score: 0,
      badges: ["usage", "silent failover", "native login"],
    });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network unavailable");
    }));

    await expect(
      adapter.createSnapshot?.({ providerName: "openai-codex-2", auth: { access: "access-token" } }),
    ).resolves.toEqual({
      summary: "",
      details: [],
      score: 0,
      badges: ["usage", "silent failover", "native login"],
    });
  });

  it("declares codex capabilities and builds alias oauth config with the OpenAI Codex helpers", async () => {
    vi.mocked(loginOpenAICodex).mockResolvedValue({
      access: "access-token",
      refresh: "refresh-token",
      expires: 123,
      accountId: "acct_123",
    });
    vi.mocked(refreshOpenAICodexToken).mockResolvedValue({
      access: "new-access-token",
      refresh: "new-refresh-token",
      expires: 456,
      accountId: "acct_123",
    });

    const adapter = createCodexAdapter();

    expect(adapter.family).toBe("openai-codex");
    expect(adapter.displayName).toBe("ChatGPT Plus/Pro (Codex)");
    expect(adapter.capabilities).toEqual({
      usage: true,
      silentFailover: true,
      nativeLogin: true,
      reauth: true,
      experimental: false,
    });
    expect(adapter.classifyRetry).toBe(classifyCodexRetry);

    const oauth = adapter.buildAliasOAuth(3);
    const callbacks = {
      onAuth: vi.fn(),
      onPrompt: vi.fn(),
      onProgress: vi.fn(),
      onManualCodeInput: vi.fn(),
    };
    const credentials = {
      access: "access-token",
      refresh: "refresh-token",
      expires: 123,
      accountId: "acct_123",
    };

    expect(oauth.name).toBe("ChatGPT Codex #3");
    expect(oauth.usesCallbackServer).toBe(true);
    await expect(oauth.login(callbacks)).resolves.toEqual({
      access: "access-token",
      refresh: "refresh-token",
      expires: 123,
      accountId: "acct_123",
    });
    expect(loginOpenAICodex).toHaveBeenCalledWith(callbacks);

    await expect(oauth.refreshToken(credentials)).resolves.toEqual({
      access: "new-access-token",
      refresh: "new-refresh-token",
      expires: 456,
      accountId: "acct_123",
    });
    expect(refreshOpenAICodexToken).toHaveBeenCalledWith("refresh-token");
    expect(oauth.getApiKey(credentials)).toBe("access-token");
  });
});
