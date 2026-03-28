# AGENTS.md — pi-bridge

## Project Overview

Multi-platform messaging bridge for Pi — extends the original pi-channels concept with streaming text support and additional adapters.

**Stack:** TypeScript (strict mode)  
**Package Manager:** npm  
**Repository:** https://github.com/luxus/pi-bridge

## Directory Layout

```
src/
├── index.ts              # Extension entry — lifecycle, flags, /chat-bridge command
├── types.ts              # Shared types (messages, adapters, config, bridge)
├── config.ts             # Settings loader
├── registry.ts           # Adapter registry + route resolution
├── events.ts             # bridge:* event handlers
├── tool.ts               # LLM tool (notify: list/send/test)
├── streaming/
│   ├── draft-stream.ts   # Core streaming logic (inspired by OpenClaw)
│   └── telegram-stream.ts # Telegram-specific streaming implementation
├── adapters/
│   ├── telegram.ts       # Enhanced Telegram adapter with streaming
│   ├── sendblue.ts       # NEW: SendBlue iMessage/SMS/RCS adapter
│   └── webhook.ts        # Generic webhook adapter
└── bridge/
    ├── bridge.ts         # Core bridge with streaming support
    ├── commands.ts       # Bot command registry
    ├── rpc-runner.ts     # Persistent RPC session manager
    ├── runner.ts         # Stateless subprocess runner
    └── typing.ts         # Typing indicator manager
```

## Architecture

- **Event bus only** — no direct imports between extensions
- **Streaming-first** — All responses can be streamed in real-time
- **Adapter pattern** — adapters implement `ChannelAdapter` interface
- **Bridge modes:**
  - `persistent` — RPC subprocess with conversation memory
  - `stateless` — isolated per message
- **Per-sender serialization** — FIFO queue, concurrent across senders

## Conventions

- TypeScript strict mode
- No `console.log` — use logger
- Config under `"pi-bridge"` key in settings.json
- Use `"env:VAR_NAME"` for secrets

## Key Differences from pi-channels

1. **Streaming support** — Real-time message updates using editMessageText/sendMessageDraft
2. **SendBlue adapter** — Native iMessage/SMS/RCS support
3. **Separate codebase** — Independent development, no conflicts with live pi-channels

## Development

This extension is developed independently from the pi monorepo:
```bash
cd ~/dev/pi-bridge
npm install
npm run typecheck
```

To use during development:
```bash
cd ~/.pi/agent/extensions
ln -s ~/dev/pi-bridge pi-bridge
```
