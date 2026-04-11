# pi-account-router

Pi-native multi-account router for subscription-backed providers.

## Goals

- Use Pi auth storage as the source of truth
- Discover existing base and alias auth entries automatically
- Keep day-to-day usage transparent
- Make Codex failover seamless before visible output starts
- Show all supported families honestly in one manager

## Install

```bash
pi install ./
```

## Commands

- `/account-router`
- `/account-router status`
- `/account-router debug`
- `/account-router add openai-codex`
- `/account-router use openai-codex-2`
- `/account-router unpin`
- `/account-router refresh`

## Safety

Do not test against live Pi config while real sessions are running.
Use a temp agent dir for development:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-account-router-test pi -e ./src/index.ts
```
