# Code Context

## Files Retrieved
1. `README.md` (lines 1-36); `CONTEXT.md` (lines 1-229); `docs/superpowers/specs/2026-04-11-pi-account-router-design.md` (lines 8-21, 58-76, 127-176, 218-251); `docs/superpowers/plans/2026-04-11-pi-account-router.md` (lines 13-87, 171-216); `docs/superpowers/plans/2026-04-15-account-router-ui-refactor.md` (lines 5-44, 46-260) - design intent, safety rules, Pi API assumptions, and the module/persistence plan.
2. `package.json` (lines 25-29); `src/index.ts` (lines 1-6) - the Pi extension entrypoint (`./src/index.ts`) and thin bootstrap.
3. `src/install.ts` (lines 81-415) - central runtime wiring: loads config/cache, discovers accounts, builds snapshots, syncs providers, registers commands, and wires Pi event hooks.
4. `src/config/store.ts` (lines 1-122); `src/config/cache.ts` (lines 1-143); `src/runtime/store.ts` (lines 1-82) - durable settings/cache and ephemeral per-session state.
5. `src/auth/discovery.ts` (lines 1-64); `src/auth/login.ts` (lines 1-199) - auth discovery and add-account login orchestration.
6. `src/providers/families.ts` (lines 1-119); `src/adapters/types.ts` (lines 1-52); `src/adapters/index.ts` (lines 1-21); `src/adapters/shared-oauth.ts` (lines 1-54); `src/adapters/codex/index.ts` (lines 1-47); `src/adapters/codex/usage.ts` (lines 1-167); `src/adapters/codex/classify.ts` (lines 1-49); `src/adapters/anthropic.ts` (lines 1-28); `src/adapters/copilot.ts` (lines 1-45); `src/adapters/gemini-cli.ts` (lines 1-27); `src/adapters/antigravity.ts` (lines 1-27) - family metadata, adapter contracts, and provider-specific quirks.
7. `src/models/live-registry.ts` (lines 1-126); `src/providers/register.ts` (lines 1-100); `src/routing/router.ts` (lines 1-47); `src/routing/failover.ts` (lines 1-27); `src/routing/stream.ts` (lines 1-202) - live model cloning, provider registration, account selection, and pre-output failover.
8. `src/accounts/catalog.ts` (lines 1-60); `src/status/footer.ts` (lines 1-111); `src/ui/account-display.ts` (lines 1-30); `src/ui/account-actions.ts` (lines 1-130); `src/ui/account-panel.ts` (lines 1-80); `src/commands/account-router.ts` (lines 11-565) - human-facing account presentation and the interactive manager.
9. `test/index.test.ts` (lines 1-81); `test/config/store.test.ts` (lines 1-81); `test/config/cache.test.ts` (lines 1-104); `test/integration/temp-agent-dir.test.ts` (lines 1-69); `test/providers/families.test.ts` (lines 1-52); `test/providers/register.test.ts` (lines 1-315); `test/auth/discovery.test.ts` (lines 1-148); `test/auth/login.test.ts` (lines 1-347); `test/routing/router.test.ts` (lines 1-118); `test/routing/stream.test.ts` (lines 1-449); `test/adapters/codex.test.ts` (lines 1-211); `test/adapters/secondary-adapters.test.ts` (lines 1-46); `test/ui/account-display.test.ts` (lines 1-93); `test/ui/account-actions.test.ts` (lines 1-102); `test/ui/account-panel.test.ts` (lines 1-134); `test/accounts/catalog.test.ts` (lines 1-93); `test/commands/account-router.test.ts` (lines 39-931); `test/install.test.ts` (lines 145-1269) - verification of persistence, live-registry cloning, routing, UI, and session-state behavior.

## Key Code
- `src/index.ts:1-6` is intentionally tiny: it just calls `installAccountRouter(pi)`.
- `src/install.ts:81-248` is the actual runtime graph: create `RuntimeStore`, seed `snapshots` from `loadAccountRouterSnapshotCache()`, build the catalog, refresh account snapshots, and compute `originalApiProviders` before `syncProviders(...)` so the transparent base-provider override does not recurse.
- `src/install.ts:251-415` is the command host + hooks layer: `/account-router` actions (`listAccounts`, `addAccount`, `pinAccount`, `unpin`, `refresh`, `refreshAccount`, `renameAccount`, `showAccountDetails`, `removeAccount`) and `pi.on("session_start" | "model_select" | "turn_end")` refresh hooks.
- `src/commands/account-router.ts:176-390` is the interactive panel implementation; `src/commands/account-router.ts:402-565` is the subcommand/text fallback handler. Note: `src/ui/account-panel.ts` is only the shell DTO; the live TUI logic lives in the command file.
- `src/config/store.ts:91-122` and `src/config/cache.ts:114-143` persist namespaced JSON under `PI_CODING_AGENT_DIR` (or `~/.pi/agent`). They merge with existing files instead of replacing them, so other extension keys survive.
- `src/runtime/store.ts:13-82` keeps session-scoped state only in memory: `activeByFamily`, `pinnedByFamily`, `exhaustedUntilByProvider`, `needsReauthByProvider`.
- `src/auth/discovery.ts:36-64` maps Pi auth storage (`authStorage.getAll()`) into ordered `DiscoveredAccount[]`; `src/auth/login.ts:115-199` handles login via `ctx.ui.custom(...)` when available, otherwise falls back to prompt/browser flows.
- `src/providers/register.ts:26-100` registers alias providers with cloned live models and transparent base providers with only `streamSimple`; `src/models/live-registry.ts:74-126` preserves live metadata while stripping secret-like headers.
- `src/routing/router.ts:13-47` selects `pinned -> active -> best score -> alias order`; `src/routing/stream.ts:87-202` retries only before visible output and only when the adapter classifies the error as retryable; `src/routing/failover.ts:10-27` marks cooldown/reauth and clears pins.
- `src/adapters/codex/usage.ts:77-167` extracts Codex usage windows + identity from `/wham/usage`; `src/adapters/codex/classify.ts:27-49` classifies quota/auth errors for silent retry. `src/adapters/copilot.ts:9-45` shows the pattern for provider-specific model mutation; `src/adapters/gemini-cli.ts:8-27` and `src/adapters/antigravity.ts:8-27` show provider-specific refresh/getApiKey encoding.
- `src/accounts/catalog.ts:21-60`, `src/ui/account-display.ts:19-30`, `src/status/footer.ts:34-111`, and `src/ui/account-actions.ts:56-130` implement the human-first naming rules: label -> identity -> provider display, plus ghost/secondary lines and details/rename/remove/reauth actions.

## Architecture
- The extension is Pi-native and alias-based: real accounts live in Pi auth storage as providers like `openai-codex-2`, not in a separate credential DB.
- Startup flow: `src/index.ts` -> `installAccountRouter()` -> bind runtime store, load cached snapshots, discover accounts from `ctx.modelRegistry.authStorage`, then refresh snapshots and register provider overrides.
- Provider registration is split deliberately: transparent base providers keep Pi’s live merged model list, while alias providers clone live models from `ctx.modelRegistry` so local `models.json` overrides and OAuth `modifyModels()` effects are preserved.
- Routing is family-scoped only. `selectAccountForFamily()` and `createFamilyRouterStream()` pick one eligible account inside the same family, and `applyRetryFailure()` only clears pin/cooldown/reauth state for retryable failures.
- Session-state persistence is split into three layers:
  1. credentials stay in Pi auth storage,
  2. durable UI prefs live in `settings.json` under the `pi-account-router` key,
  3. derived health/snapshot data lives in `pi-account-router-cache.json`.
  Runtime selection (`active/pinned/exhausted/reauth`) stays in memory.
- The command surface is both text and TUI: `/account-router status|debug|add|use|unpin|refresh` plus the default interactive panel. The UI is intentionally human-first and uses cached snapshots immediately; refresh happens asynchronously on hooks so the panel can open without waiting on usage calls.
- Important constraint for a new Pi extension: follow the live-model-registry pattern, not static provider snapshots. This repo is specifically protecting local model overrides and avoiding secret leakage in cloned headers.

## Start Here
`src/install.ts` (lines 81-415) — it is the best single file for understanding the lifecycle: config load, auth discovery, snapshot caching, provider registration, routing hooks, and UI refresh behavior.
