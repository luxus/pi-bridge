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
- `src/adapters/tts.ts` — TTS providers: apple, openai, elevenlabs, **xai**
- `src/scheduler/scheduler.ts` — Cron job scheduler with expression parser

## TTS & Voice Mode

When `voiceMode.enabled: true`, the bridge can send responses as voice messages using TTS.

### How it works

1. **You write clean text** — No special formatting needed
2. **System optimizes automatically** — Adds speech tags (pauses, emotions) for voice output
3. **Text stays clean** — Original text unchanged for text output
4. **Voice gets enhanced** — Automatic optimization when sending as voice

### xAI Speech Tags (complete list)

The system automatically adds these tags based on text analysis:

**Inline Tags** (placed at specific points):
```
Pauses:        [pause], [long-pause]
Laughter:      [laugh], [chuckle], [giggle], [cry]
Mouth sounds:  [tsk], [tongue-click], [lip-smack]
Breathing:     [breath], [inhale], [exhale], [sigh]
Vocal effects: [hum-tune]
```

**Wrapping Tags** (wrap text sections):
```
Volume:        <soft>, <loud>, <build-intensity>, <decrease-intensity>
Pitch/Speed:   <higher-pitch>, <lower-pitch>, <slow>, <fast>
Style:         <whisper>, <sing-song>, <singing>, <laugh-speak>, <emphasis>
```

### Configuration

```json
{
  "pi-bridge": {
    "adapters": {
      "telegram": {
        "tts": {
          "enabled": true,
          "provider": "xai",
          "voice": "ara",
          "language": "auto"
        }
      }
    },
    "bridge": {
      "voiceMode": {
        "enabled": true,
        "autoSwitch": true
      }
    }
  }
}
```

### Voice Best Practices

- **Keep voice messages short** — 30-60 seconds maximum (about 3 sentences)
- **Rewrite, don't read** — Transform tables/lists into 3-sentence summaries
- **3-Sentence formula:** Headline → Detail → Call-to-Action
- **Use natural punctuation** — System adds `[pause]`, `[laugh]` based on `!`, `?`, etc.
- **Auto-switch**: Voice in → Voice out, Text in → Text out

See full skill documentation: `.agents/skills/pi-bridge-tts/SKILL.md`
