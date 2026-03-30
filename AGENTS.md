# AGENTS.md — pi-bridge

## Project Overview

Multi-platform messaging bridge for pi — routes messages between agents and external services (Telegram, Slack, Discord, iMessage/SendBlue, webhooks). Includes chat bridge with persistent RPC sessions, cron scheduler, streaming, and platform-aware formatting.

**Stack:** TypeScript (strict mode)
**Package Manager:** npm

## Directory Layout

```
src/
├── index.ts              # Extension entry — lifecycle, flags, /chat-bridge & /scheduler commands
├── types.ts              # All shared types (messages, adapters, config, bridge, scheduler, streaming)
├── config.ts             # Settings loader (reads "pi-bridge" from settings.json)
├── registry.ts           # Adapter registry + route resolution (5 built-in factories)
├── events.ts             # bridge:* event handlers + cron:job_complete wiring
├── tool.ts               # LLM tool (notify: list/send/test)
├── logger.ts             # Logging utility
├── chat-history.ts       # Config-driven chat history storage
├── adapters/
│   ├── telegram.ts       # Telegram Bot API adapter (polling, typing, streaming, MD→HTML, voice, documents)
│   ├── slack.ts          # Slack adapter (Socket Mode + Web API, threads, slash commands)
│   ├── discord.ts        # Discord adapter (discord.js, threads, slash commands, streaming)
│   ├── sendblue.ts       # SendBlue/iMessage adapter (API v2 + webhook, typing, read receipts)
│   ├── webhook.ts        # Generic webhook adapter (outgoing)
│   └── transcription.ts  # Audio transcription providers (apple, openai, elevenlabs)
├── bridge/
│   ├── bridge.ts         # Core bridge — per-sender queues, concurrency, streaming integration
│   ├── commands.ts       # Bot command registry (/start, /help, /abort, /status, /new)
│   ├── rpc-runner.ts     # Persistent RPC session manager (pi --mode rpc)
│   ├── runner.ts         # Stateless subprocess runner (pi -p --no-session) with onData streaming
│   └── typing.ts         # Typing indicator manager
├── formatting/
│   └── telegram-html.ts  # Markdown → Telegram HTML converter
├── streaming/
│   └── draft-stream.ts   # Generic + Telegram-specific streaming infrastructure
└── scheduler/
    └── scheduler.ts      # Cron scheduler with built-in expression parser
```

## Architecture

- **Event bus only** — no direct imports between extensions. Communication via `bridge:send`, `bridge:receive`, `bridge:register`
- **Adapter pattern** — 5 built-in adapters (telegram, slack, discord, sendblue, webhook) + custom adapters via event registration
- **Bridge modes:**
  - `persistent: true` (default) — each sender gets a `pi --mode rpc` subprocess with conversation memory
  - `persistent: false` — each message spawns an isolated `pi -p --no-session` subprocess
- **Per-sender serialization** — one prompt at a time per sender, FIFO queue, concurrent across senders
- **Streaming** — adapters with `createStream()` support progressive message updates
- **Cron scheduler** — 5-field cron expressions, "message" and "prompt" job types
- **Telegram formatting** — auto-converts markdown to Telegram HTML when parseMode is "HTML"
- **No console.log** — use the logger module

## Conventions

- TypeScript strict mode
- No direct imports between extensions — all via event bus
- Config lives in settings.json under `"pi-bridge"` key
- Use `"env:VAR_NAME"` for secrets in config

## Key Files

- `package.json` — dependencies, scripts
- `tsconfig.json` — TypeScript config
- `README.md` — Full documentation with config reference
- `src/index.ts` — Extension entry point, command registration
- `src/registry.ts` — Adapter factory registration (telegram, slack, discord, sendblue, webhook)
- `src/bridge/bridge.ts` — Core bridge logic with per-sender queues
- `src/bridge/rpc-runner.ts` — Persistent RPC session management
- `src/adapters/telegram.ts` — Full-featured Telegram adapter with streaming support
- `src/scheduler/scheduler.ts` — Cron job scheduler with expression parser
