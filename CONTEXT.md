# pi-account-router Context

## Goal

Build a Pi extension for routing requests across multiple authenticated subscription accounts, starting from the lessons learned while testing `@victor-software-house/pi-multicodex` and auditing `pi-multi-pass`.

The target is not "more features first." The target is an account router that is boring, predictable, model-registry aware, and safe to run in real Pi sessions.

## Name

Chosen project name: `pi-account-router`.

Name checks performed on April 11, 2026:

- `npm view pi-account-router` returned `E404`.
- `npm view pi-oauth-router` returned `E404`.
- `npm view pi-subscription-router` returned `E404`.
- Web search did not show a meaningful existing `pi-account-router` collision.

## Safety Rule

Do not test early builds against the live Pi config while real sessions are running.

Use isolated agent directories for experiments, for example:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-account-router-test pi
```

or the equivalent temp-run command for a local Pi build.

Do not write to these live files during experiments unless explicitly approved:

- `/Users/marko/.pi/agent/auth.json`
- `/Users/marko/.pi/agent/settings.json`
- `/Users/marko/.pi/agent/models.json`
- `/Users/marko/.config/pi/settings.json`

## Existing Projects Audited

### `@victor-software-house/pi-multicodex`

Local audit checkout:

- `/tmp/pi-ext-audit/pi-multicodex`

Relevant files:

- `provider.ts`: overrides `openai-codex` and mirrors the Codex provider.
- `stream-wrapper.ts`: wraps provider streaming and retries before output has been forwarded.
- `account-manager.ts`: owns managed account storage, token refresh, usage cache, account selection, and Pi-auth import.
- `auth.ts`: reads Pi's `auth.json` and extracts importable `openai-codex` OAuth state.
- `hooks.ts`: session-start/session-switch activation logic.
- `storage.ts`: stores managed accounts in `codex-accounts.json`.
- `status.ts`: footer/status UI and preferences.
- `commands.ts`: `/multicodex` command family.

Good ideas:

- Stream-level retry is the right idea for Codex failover.
- It avoids retrying after visible assistant output has already started.
- It has modular files, a real test suite, release tooling, schemas, and docs.
- It has a cohesive command surface under `/multicodex`.
- It has useful Codex usage-window logic and footer ideas.

Problems found:

- It creates a second credential database in `codex-accounts.json`.
- Its first-run Pi-auth import path is broken upstream: `handleSessionStart()` exits early when there are zero managed accounts, so existing `openai-codex` auth is not imported.
- Its tests codify that broken first-run behavior.
- It mirrors static `pi-ai` model data instead of Pi's live `ModelRegistry`; this clobbered the local `models.json` override that sets `gpt-5.4` to a 1.05M context window.
- The shared `pi-provider-utils` helper also mirrors `getModels()` from `@mariozechner/pi-ai`, so the stale-model issue is systemic.

Local patches made to the installed package, not upstream:

- Patched `hooks.ts` so existing Pi auth can be imported even with zero managed accounts.
- Patched `provider.ts` so the mirrored provider respects local `openai-codex.modelOverrides`.

These patches can be overwritten by reinstalling or updating the package.

### `pi-multi-pass`

Local audit checkout:

- `/tmp/pi-ext-audit/pi-multi-pass`

Relevant file:

- `extensions/multi-sub.ts`

Supported provider families:

- `anthropic`
- `openai-codex`
- `github-copilot`
- `google-gemini-cli`
- `google-antigravity`

Good ideas:

- Better core auth model than MultiCodex: extra accounts are registered as provider aliases such as `openai-codex-2`, and credentials live in Pi's normal `auth.json`.
- It uses Pi's `registerProvider()` and OAuth integration to let `/login` authenticate extra provider aliases.
- It supports pools, project affinity, quota-first, scheduled routing, custom selector scripts, chains, and presets.
- It is more active and has stronger GitHub community signal than `pi-multicodex`.

Problems found:

- The runtime is one large file, about 5.7k lines.
- It mixes provider templates, auth, config, quota checks, routing, TUI, commands, project config, and failover state in one module.
- Its tests are lightweight script checks, not full extension integration tests.
- Its failover happens after `agent_end`, then it switches model and replays the last prompt using `pi.sendUserMessage(lastUserPrompt)`. That is generic, but less precise than request/stream-level retry.
- It clones models from static `getModels()` rather than the live merged `ModelRegistry`, so provider aliases can miss local `models.json` overrides.
- It directly uses `ctx.modelRegistry.authStorage.*` and `ctx.modelRegistry.refresh()`. These exist in source, but are not documented as the primary extension API in the same way as `registerProvider()` and `ctx.modelRegistry.find()`.

Conclusion:

- `pi-multi-pass` has the better high-level architecture.
- `pi-multicodex` has cleaner code boundaries and a better Codex retry seam.
- Neither should be copied as-is.

## Pi Surfaces To Rely On

Relevant docs/source inspected:

- `/tmp/pi-mono/packages/coding-agent/docs/extensions.md`
- `/tmp/pi-mono/packages/coding-agent/docs/custom-provider.md`
- `/tmp/pi-mono/packages/coding-agent/docs/models.md`
- `/tmp/pi-mono/packages/coding-agent/docs/providers.md`
- `/tmp/pi-mono/packages/coding-agent/src/core/extensions/types.ts`
- `/tmp/pi-mono/packages/coding-agent/src/core/auth-storage.ts`
- `/tmp/pi-mono/packages/coding-agent/src/core/model-registry.ts`

Supported Pi primitives:

- `pi.registerProvider(name, config)`
- `pi.unregisterProvider(name)`
- `pi.registerCommand(name, options)`
- `pi.on("session_start", handler)`
- `pi.on("before_agent_start", handler)`
- `pi.on("agent_end", handler)`
- `pi.setModel(model)`
- `ctx.modelRegistry.find(provider, modelId)`
- `ctx.modelRegistry.authStorage` exists, but should be treated carefully because only parts of `modelRegistry` usage are clearly documented for extensions.

Model metadata rule:

- Use Pi's live merged model registry for model metadata whenever possible.
- Do not clone aliases directly from `@mariozechner/pi-ai.getModels()` unless we also apply `models.json` overrides, provider overrides, and OAuth `modifyModels()` effects correctly.

This matters because the installed Pi metadata currently reports `openai-codex/gpt-5.4` as `272000`, while the local merged model override reports `1050000`.

## OpenAI/Codex Context

Official OpenAI docs say GPT-5.4 supports a 1.05M context window.

Sources:

- https://developers.openai.com/api/docs/models/gpt-5.4
- https://developers.openai.com/api/docs/guides/latest-model#new-features-in-gpt-54
- https://developers.openai.com/codex/config-reference#configtoml

Local Pi override:

- `/Users/marko/.config/pi/models.json`
- `/Users/marko/.pi/agent/models.json`

The project must not accidentally regress `gpt-5.4` context back to stale `272000` when registering account aliases.

## Initial Architecture Direction

Build as a Pi extension package with small modules:

- `src/index.ts`: extension entrypoint and wiring only.
- `src/providers/registry.ts`: provider-family definitions and alias registration.
- `src/models/clone.ts`: model alias cloning that respects live model metadata.
- `src/auth/aliases.ts`: account alias naming and auth-store interaction.
- `src/routing/pool.ts`: pool config and available-account selection.
- `src/routing/failover.ts`: failover policy and retry safety rules.
- `src/codex/stream-wrapper.ts`: Codex-specific pre-stream retry wrapper.
- `src/config/store.ts`: global/project config load/save with schema validation.
- `src/commands/*.ts`: command handlers.
- `src/status/footer.ts`: minimal status display.
- `test/*`: unit and integration-style tests with temp agent dirs.

## Design Principles

- Pi-native auth only.
- No separate credential database.
- No raw token duplication unless Pi itself stores it.
- Use provider aliases such as `openai-codex-2` for extra accounts.
- Preserve local `models.json` overrides.
- Prefer explicit, testable behavior over clever hidden heuristics.
- Avoid a giant single-file extension.
- Avoid broad multi-provider complexity until the shared abstraction is real.
- Never test against live config by default.

## Possible Version Scope

### v1

- Codex account aliases.
- Pi-native OAuth login for aliases.
- Manual switch/list/status.
- Simple pool rotation for `openai-codex`.
- Pre-stream retry for Codex when a quota/rate-limit error happens before output starts.
- Preserve model metadata overrides.
- Minimal footer/status.
- Temp-agent-dir integration tests.

### v2

- Add `anthropic` account aliases.
- Add provider-family adapter interface if v1 proves the shape.
- Add stricter project-level allow-list only if needed.

### v3

- Consider `github-copilot`, `google-gemini-cli`, and `google-antigravity`.
- Only add these after confirming their login, refresh, quota, and retry semantics in isolation.

## Anti-Goals For v1

- No custom JS selector scripts.
- No chains/presets.
- No scheduled routing.
- No external proxy/tray app.
- No second credential store.
- No direct live-config migration until the extension is tested in isolated agent dirs.
- No broad provider support if it compromises Codex correctness.
