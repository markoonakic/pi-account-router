import { describe, expect, it } from "vitest";

import { buildAccountCatalog } from "../../src/accounts/catalog.js";
import { createRuntimeStore } from "../../src/runtime/store.js";
import { applyRetryFailure } from "../../src/routing/failover.js";
import { selectAccountForFamily } from "../../src/routing/router.js";
import type { DiscoveredAccount } from "../../src/auth/discovery.js";

const accounts: DiscoveredAccount[] = [
  {
    family: "openai-codex",
    providerName: "openai-codex",
    aliasIndex: 1,
    authenticated: true,
    authType: "oauth",
  },
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
];

describe("family router selection", () => {
  it("prefers a pinned account when eligible", () => {
    const store = createRuntimeStore();
    store.replaceAccounts(accounts);
    store.setPinnedProvider("openai-codex", "openai-codex-2");

    expect(selectAccountForFamily("openai-codex", store.getAccounts(), store.getState())).toBe("openai-codex-2");
  });

  it("sticks to the active account when no pin is set", () => {
    const store = createRuntimeStore();
    store.replaceAccounts(accounts);
    store.setActiveProvider("openai-codex", "openai-codex-3");

    expect(selectAccountForFamily("openai-codex", store.getAccounts(), store.getState())).toBe("openai-codex-3");
  });

  it("picks the best eligible account by score before alias order", () => {
    const store = createRuntimeStore();
    store.replaceAccounts(accounts);

    expect(
      selectAccountForFamily("openai-codex", store.getAccounts(), store.getState(), {
        "openai-codex": 5,
        "openai-codex-2": 25,
        "openai-codex-3": 10,
      }),
    ).toBe("openai-codex-2");
  });

  it("skips exhausted accounts and falls back deterministically", () => {
    const store = createRuntimeStore();
    store.replaceAccounts(accounts);
    store.markExhausted("openai-codex", Date.now() + 60_000);
    store.markExhausted("openai-codex-2", Date.now() + 60_000);

    expect(selectAccountForFamily("openai-codex", store.getAccounts(), store.getState())).toBe("openai-codex-3");
  });

  it("builds catalog rows with active, pinned, cooldown, and badges", () => {
    const store = createRuntimeStore();
    store.replaceAccounts(accounts);
    store.setActiveProvider("openai-codex", "openai-codex-2");
    store.setPinnedProvider("openai-codex", "openai-codex-2");
    store.markExhausted("openai-codex-3", Date.now() + 60_000);

    const catalog = buildAccountCatalog(store.getAccounts(), store.getState(), {
      "openai-codex-2": {
        summary: "5h 80% | 7d 65%",
        details: [],
        score: 80,
        badges: ["usage", "silent failover"],
      },
    });

    expect(catalog.find((entry) => entry.providerName === "openai-codex-2")).toMatchObject({
      active: true,
      pinned: true,
      summary: "5h 80% | 7d 65%",
      badges: ["usage", "silent failover"],
    });
    expect(catalog.find((entry) => entry.providerName === "openai-codex-3")).toMatchObject({ exhausted: true });
  });

  it("applies retry failure bookkeeping for cooldown, reauth, and pin clearing", () => {
    const store = createRuntimeStore();
    store.replaceAccounts(accounts);
    store.setPinnedProvider("openai-codex", "openai-codex-2");

    applyRetryFailure(store, "openai-codex", "openai-codex-2", {
      reason: "auth",
      cooldownUntil: Date.now() + 60_000,
      clearPin: true,
    });

    expect(store.getState()).toMatchObject({
      pinnedByFamily: {},
      exhaustedUntilByProvider: {
        "openai-codex-2": expect.any(Number),
      },
      needsReauthByProvider: {
        "openai-codex-2": true,
      },
    });
  });
});
