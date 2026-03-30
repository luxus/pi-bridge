# @e9n/pi-bridge

Two-way channel extension for [pi](https://github.com/espennilsen/pi). Route messages between agents and external services: Telegram, Slack, Discord, SendBlue (iMessage), webhooks, or custom adapters. Includes a chat bridge with persistent RPC sessions for conversational bots, plus a scheduler for cron-based automation.

## Features

- **Telegram adapter** — bidirectional via Bot API; polling, voice/audio transcription, document support (PDF, Office), Markdown to HTML auto-conversion, streaming updates
- **Slack adapter** — bidirectional via Socket Mode + Web API; thread-aware routing, slash commands, mention filtering
- **Discord adapter** — bidirectional via discord.js; thread support, slash commands, streaming via edit-message pattern
- **SendBlue adapter** — bidirectional iMessage/SMS/RCS via SendBlue API; typing indicators, read receipts, reactions, group messaging
- **Webhook adapter** — outgoing HTTP POST/PUT/PATCH/GET/DELETE with envelope or raw payload modes
- **Chat bridge** — incoming messages routed to the agent as prompts; responses sent back automatically; persistent (RPC) or stateless mode
- **Streaming** — progressive message updates for adapters that support edit-message (Telegram, Discord)
- **Scheduler** — cron-based job execution for automated messages and prompts
- **Event API** — `bridge:send`, `bridge:receive`, `bridge:register`, `cron:job_complete` for inter-extension messaging
- **Custom adapters** — register at runtime via `bridge:register` event

## Install

```bash
pi install npm:@e9n/pi-bridge
```

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json` under the `pi-bridge` key:

```json
{
  "pi-bridge": {
    "adapters": {
      "telegram": {
        "type": "telegram",
        "botToken": "your-telegram-bot-token",
        "polling": true,
        "parseMode": "HTML",
        "allowedChatIds": ["123456789", "-100987654321"],
        "transcription": {
          "enabled": true,
          "provider": "openai"
        },
        "markitdown": {
          "enabled": true
        }
      },
      "slack": {
        "type": "slack",
        "allowedChannelIds": ["C0123456789"],
        "respondToMentionsOnly": true,
        "slashCommand": "/aivena"
      },
      "discord": {
        "type": "discord",
        "allowedChannelIds": ["123456789012345678"],
        "respondToMentionsOnly": true,
        "slashCommand": "/ask"
      },
      "sendblue": {
        "type": "sendblue",
        "apiKeyId": "your-api-key-id",
        "apiSecret": "your-api-secret",
        "sendblueNumber": "+1234567890",
        "webhookPath": "/webhook/sendblue",
        "typingIndicators": true,
        "readReceipts": true
      },
      "alerts": {
        "type": "webhook",
        "method": "POST",
        "contentType": "application/json",
        "payloadMode": "envelope",
        "secret": "your-webhook-secret",
        "headers": { "X-Custom-Header": "value" }
      }
    },
    "slack": {
      "appToken": "xapp-1-...",
      "botToken": "xoxb-..."
    },
    "discord": {
      "botToken": "your-discord-bot-token"
    },
    "routes": {
      "ops": { "adapter": "telegram", "recipient": "-100987654321" },
      "dev-alerts": { "adapter": "slack", "recipient": "C0123456789" },
      "general": { "adapter": "discord", "recipient": "123456789012345678" }
    },
    "bridge": {
      "enabled": false,
      "sessionMode": "persistent",
      "sessionRules": [{ "match": "telegram:-100*", "mode": "stateless" }],
      "idleTimeoutMinutes": 30,
      "maxQueuePerSender": 5,
      "timeoutMs": 300000,
      "maxConcurrent": 2,
      "model": null,
      "typingIndicators": true,
      "commands": true,
      "streaming": false,
      "streamingThrottleMs": 500,
      "streamingMinChars": 30,
      "extensions": []
    },
    "scheduler": {
      "enabled": true,
      "jobs": {
        "daily-standup": {
          "schedule": "0 9 * * 1-5",
          "type": "message",
          "content": "Good morning team! Time for standup.",
          "channel": "ops",
          "enabled": true,
          "timezone": "America/New_York"
        },
        "hourly-check": {
          "schedule": "0 * * * *",
          "type": "prompt",
          "content": "Check system status and report any issues",
          "channel": "ops",
          "enabled": true
        }
      }
    }
  }
}
```

**Secrets:**
- Set secret values (tokens, keys) directly in `settings.json`
- Use `"env:VAR_NAME"` syntax to reference environment variables
- Project settings override global ones
- Environment variables override settings.json (see Environment Variable Overrides section)

### Adapters

#### Telegram

Bidirectional Telegram Bot API adapter with polling support.

**Configuration:**

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `botToken` | string | Yes | — | Telegram bot token from @BotFather |
| `polling` | boolean | No | false | Enable long-polling for incoming messages |
| `pollingTimeout` | number | No | 30 | Polling timeout in seconds |
| `parseMode` | string | No | "HTML" | Message format: "HTML" or "Markdown" |
| `allowedChatIds` | string[] | No | — | Whitelist of chat IDs that can interact with the bot |
| `transcription` | object | No | — | Voice/audio transcription config |
| `markitdown` | object | No | — | PDF/Office document conversion config |

**Markdown to HTML Auto-Conversion:**

When `parseMode` is "HTML" (default), Markdown is automatically converted to Telegram HTML:

| Markdown | Telegram HTML |
|----------|---------------|
| `**bold**` or `__bold__` | `<b>bold</b>` |
| `*italic*` or `_italic_` | `<i>italic</i>` |
| `***bold italic***` | `<b><i>bold italic</i></b>` |
| `~~strikethrough~~` | `<s>strikethrough</s>` |
| `||spoiler||` | `<tg-spoiler>spoiler</tg-spoiler>` |
| `` `code` `` | `<code>code</code>` |
| ```` ```code``` ```` | `<pre>code</pre>` or `<pre><code class="language-X">` |
| `> quote` | `<blockquote>quote</blockquote>` |
| `[text](url)` | `<a href="url">text</a>` |
| `https://...` | `<a href="https://...">https://...</a>` |

Unsupported elements (headings, lists, horizontal rules) are converted to plain-text equivalents:
- Headings become bold text
- Lists become bullet points with indentation
- Horizontal rules become unicode separators (—————)

**Streaming:**

Telegram supports progressive message updates via `editMessageText`. Enable in bridge config:

```json
{
  "pi-bridge": {
    "bridge": {
      "streaming": true,
      "streamingThrottleMs": 500,
      "streamingMinChars": 30
    }
  }
}
```

**Voice/Audio Transcription:**

Transcribe voice messages and audio files using Apple (macOS), OpenAI Whisper, or ElevenLabs Scribe:

```json
{
  "telegram": {
    "transcription": {
      "enabled": true,
      "provider": "openai",
      "apiKey": "optional-for-openai",
      "model": "whisper-1",
      "language": "en"
    }
  }
}
```

| Provider | Requirements | Notes |
|----------|--------------|-------|
| `apple` | macOS only | Free, offline, uses SFSpeechRecognizer. No API key needed. |
| `openai` | OpenAI API key | Automatically uses pi's built-in OpenAI authentication if you've run `/login openai`. No explicit `apiKey` needed. Override with `apiKey` in config if you want to use a separate key. |
| `elevenlabs` | ElevenLabs API key | Requires `apiKey` set directly in config. |

**Document Support (PDF, Office):**

The Telegram adapter supports PDF and Office documents with optional markitdown conversion:

**Supported formats:**
- PDF (.pdf)
- Microsoft Word (.docx, .doc)
- Microsoft Excel (.xlsx, .xls)
- Microsoft PowerPoint (.pptx, .ppt)
- OpenDocument (.odt, .ods, .odp)
- Rich Text (.rtf)

**Size limits:**
- Text files: 1MB
- Documents (PDF, Office): 20MB
- Images: 1MB
- Audio: 10MB

```json
{
  "telegram": {
    "markitdown": {
      "enabled": true
    }
  }
}
```

Documents are downloaded and passed as attachments. With `markitdown` installed, text content is extracted and included in the message.

#### Slack

Bidirectional Slack adapter using Socket Mode (WebSocket) for events and Web API for sending.

**Configuration:**

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `allowedChannelIds` | string[] | No | — | Whitelist of channel IDs |
| `respondToMentionsOnly` | boolean | No | false | Only respond to @mentions in channels |
| `slashCommand` | string | No | "/aivena" | Slash command to register |

**Token Configuration:**

Slack tokens live in settings under `pi-bridge.slack` (not in the adapter config block):

```json
{
  "pi-bridge": {
    "adapters": {
      "slack": {
        "type": "slack",
        "allowedChannelIds": ["C0123456789"],
        "respondToMentionsOnly": true,
        "slashCommand": "/aivena"
      }
    },
    "slack": {
      "appToken": "xapp-1-...",
      "botToken": "xoxb-..."
    }
  }
}
```

- `appToken` — App-level token (xapp-...) for Socket Mode
- `botToken` — Bot token (xoxb-...) for Web API

**Features:**
- Thread-aware routing (replies in threads stay in threads)
- @mention handling (strips bot mention from message text)
- Slash command support
- Message splitting for long messages (>3000 chars)

#### Discord

Bidirectional Discord adapter using discord.js.

**Configuration:**

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `allowedChannelIds` | string[] | No | — | Whitelist of channel IDs |
| `respondToMentionsOnly` | boolean | No | false | Only respond to @mentions in guild channels |
| `slashCommand` | string | No | "/ask" | Slash command to register |

**Token Configuration:**

Discord token lives in settings under `pi-bridge.discord`:

```json
{
  "pi-bridge": {
    "adapters": {
      "discord": {
        "type": "discord",
        "allowedChannelIds": ["123456789012345678"],
        "respondToMentionsOnly": true,
        "slashCommand": "/ask"
      }
    },
    "discord": {
      "botToken": "your-discord-bot-token"
    }
  }
}
```

**Features:**
- Guild and DM support
- Thread support (threads treated as separate conversation contexts)
- Slash command support with ephemeral replies
- Streaming via edit-message pattern
- Message splitting for long messages (>2000 chars)

**Intents used:**
- Guilds
- GuildMessages
- DirectMessages
- MessageContent

#### SendBlue (iMessage)

Bidirectional adapter for iMessage, SMS, and RCS via SendBlue API.

**Configuration:**

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `apiKeyId` | string | Yes | — | SendBlue API key ID |
| `apiSecret` | string | Yes | — | SendBlue API secret |
| `sendblueNumber` | string | No | — | Your SendBlue phone number |
| `webhookPath` | string | No | "/webhook/sendblue" | Path for incoming webhooks |
| `typingIndicators` | boolean | No | false | Send typing indicators |
| `readReceipts` | boolean | No | false | Send read receipts automatically |

**Environment Variable Overrides:**

SendBlue supports env var overrides for secrets:
- `SENDBLUE_API_KEY_ID` → overrides `apiKeyId`
- `SENDBLUE_API_SECRET` → overrides `apiSecret`
- `SENDBLUE_NUMBER` → overrides `sendblueNumber`

You can also use `"env:VAR_NAME"` syntax in settings.json:

```json
{
  "sendblue": {
    "type": "sendblue",
    "apiKeyId": "env:SENDBLUE_API_KEY_ID",
    "apiSecret": "env:SENDBLUE_API_SECRET",
    "sendblueNumber": "env:SENDBLUE_NUMBER"
  }
}
```

**Features:**
- Text messages (SMS, MMS, iMessage, RCS)
- Group messaging
- Reactions (tapbacks on iMessage)
- Typing indicators
- Read receipts
- Media attachments (images, video)

**Incoming Webhooks:**

Incoming messages are received via webhook mounted on the pi-webserver extension (requires `pi-webserver` to be installed and running). The webhook handler is registered automatically when the adapter starts.

#### Webhook

Outgoing HTTP adapter for sending messages to any webhook URL.

**Configuration:**

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `method` | string | No | "POST" | HTTP method |
| `contentType` | string | No | "application/json" | Content-Type header |
| `payloadMode` | string | No | "envelope" | "envelope" or "raw" |
| `secret` | string | No | — | Bearer token for Authorization header |
| `headers` | object | No | {} | Additional HTTP headers |

**Payload Modes:**

- **envelope** (default): Sends `{ text, source, metadata, timestamp }`
- **raw**: Sends `rawBody` as-is (string or JSON-serialized)

**Authentication:**

If no Authorization header is explicitly set in `headers`, the `secret` config field (or `WEBHOOK_SECRET` env var) is used as a Bearer token automatically.

### Routes

Routes are aliases that map friendly names to adapter + recipient combinations. They simplify sending messages from cron jobs, tools, and other extensions.

```json
{
  "pi-bridge": {
    "routes": {
      "ops": { "adapter": "telegram", "recipient": "-100987654321" },
      "dev-alerts": { "adapter": "slack", "recipient": "C0123456789" },
      "general": { "adapter": "discord", "recipient": "123456789012345678" }
    }
  }
}
```

Usage with the `notify` tool:
- `notify send adapter=ops text="Hello team"` — sends to the "ops" route

### Chat Bridge

The chat bridge routes incoming messages from adapters to the agent as prompts, then sends responses back to the original sender. It supports two session modes:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable on startup (also: `--chat-bridge` flag or `/chat-bridge on`) |
| `sessionMode` | `"persistent"` | `"persistent"` = RPC subprocess with conversation memory; `"stateless"` = isolated per message |
| `sessionRules` | `[]` | Per-sender mode overrides (see below) |
| `idleTimeoutMinutes` | `30` | Kill idle persistent sessions after N minutes |
| `maxQueuePerSender` | `5` | Max queued messages per sender before rejecting |
| `timeoutMs` | `300000` | Per-prompt timeout in milliseconds (5 min) |
| `maxConcurrent` | `2` | Max senders processed in parallel |
| `model` | `null` | Model override for subprocess (null = use default) |
| `typingIndicators` | `true` | Send typing indicators while processing |
| `commands` | `true` | Handle bot commands like /start, /help, /abort |
| `streaming` | `false` | Enable streaming (progressive message updates) |
| `streamingThrottleMs` | `500` | Throttle streaming updates to every N ms |
| `streamingMinChars` | `30` | Minimum chars before first streaming send |
| `extensions` | `[]` | Extension paths to load in bridge subprocesses |

**Session Rules:**

Per-sender session mode overrides let you customize behavior for specific senders. Each rule matches sender keys (`adapter:senderId`) against glob patterns. First match wins.

```json
{
  "pi-bridge": {
    "bridge": {
      "sessionRules": [
        { "match": "telegram:-100*", "mode": "stateless" },
        { "match": "webhook:*", "mode": "stateless" },
        { "match": "telegram:123456789", "mode": "persistent" }
      ]
    }
  }
}
```

**Extensions:**

Subprocesses run with `--no-extensions` by default to avoid conflicts (e.g., webserver port collisions). List only the extensions the bridge agent needs:

```json
{
  "pi-bridge": {
    "bridge": {
      "extensions": ["/Users/you/Dev/pi/extensions/pi-vault/src/index.ts"]
    }
  }
}
```

### Streaming

Streaming provides progressive message updates as the agent generates responses. The adapter must implement `createStream()` to support this feature.

**How it works:**
1. An initial message is sent when content reaches `streamingMinChars`
2. Subsequent updates are throttled to every `streamingThrottleMs` milliseconds
3. The message is edited in-place with new content
4. Finalize converts the draft to a permanent message

**Supported adapters:**
- Telegram (via `editMessageText`)
- Discord (via `edit`)

Enable streaming in bridge config:

```json
{
  "pi-bridge": {
    "bridge": {
      "streaming": true,
      "streamingThrottleMs": 500,
      "streamingMinChars": 30
    }
  }
}
```

### Scheduler

The scheduler runs cron-based jobs for automated messaging and prompts.

**Configuration:**

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `enabled` | boolean | No | false | Enable the scheduler |
| `jobs` | object | Yes | — | Job definitions (key = job name) |

**Job Configuration:**

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `schedule` | string | Yes | — | 5-field cron expression (minute hour day month weekday) |
| `type` | string | Yes | — | "message" or "prompt" |
| `content` | string | Yes | — | Message text (for "message") or prompt (for "prompt") |
| `channel` | string | Yes | — | Target adapter name or route alias |
| `recipient` | string | No | — | Target recipient (if not using a route alias) |
| `enabled` | boolean | No | true | Whether this job is enabled |
| `timezone` | string | No | system | Timezone for the schedule |

**Cron Format:**

5 fields: `minute hour day-of-month month day-of-week`

- Minute: 0-59
- Hour: 0-23
- Day of month: 1-31
- Month: 1-12
- Day of week: 0-6 (0 = Sunday)

Special characters:
- `*` — any value
- `*/N` — every N (step)
- `N,M` — list of values
- `N-M` — range

**Examples:**

```json
{
  "pi-bridge": {
    "scheduler": {
      "enabled": true,
      "jobs": {
        "daily-standup": {
          "schedule": "0 9 * * 1-5",
          "type": "message",
          "content": "Good morning team! Time for standup.",
          "channel": "ops",
          "enabled": true,
          "timezone": "America/New_York"
        },
        "hourly-check": {
          "schedule": "0 * * * *",
          "type": "prompt",
          "content": "Check system status and report any issues",
          "channel": "ops",
          "enabled": true
        },
        "weekly-summary": {
          "schedule": "0 17 * * 5",
          "type": "prompt",
          "content": "Generate a weekly summary of completed tasks",
          "channel": "dev-alerts",
          "enabled": false
        }
      }
    }
  }
}
```

### Environment Variable Overrides

The following environment variables override settings.json values:

| Variable | Overrides |
|----------|-----------|
| `TELEGRAM_BOT_TOKEN` | `adapters.telegram.botToken` |
| `WEBHOOK_SECRET` | `adapters.webhook.secret` |
| `SENDBLUE_API_KEY_ID` | `adapters.sendblue.apiKeyId` |
| `SENDBLUE_API_SECRET` | `adapters.sendblue.apiSecret` |
| `SENDBLUE_NUMBER` | `adapters.sendblue.sendblueNumber` |

Environment variables take highest priority and will create adapter entries with default types if they don't exist in settings.

## Tool: notify

The `notify` tool lets LLMs send messages via configured adapters.

| Action | Required params | Description |
|--------|-----------------|-------------|
| `send` | `adapter`, (`text` or `json`) | Send a message via an adapter name or route alias |
| `list` | — | Show configured adapters and routes |
| `test` | `adapter` | Send a test ping |

**Send parameters:**

| Parameter | Description |
|-----------|-------------|
| `adapter` | Adapter name or route alias (required) |
| `recipient` | Recipient override (optional if using route) |
| `text` | Message text (required for envelope mode) |
| `source` | Source label (optional) |
| `json` | Custom JSON payload string (switches to raw mode) |
| `payloadMode` | "envelope" or "raw" (default: envelope) |
| `method` | HTTP method override for webhook raw mode |
| `contentType` | Content-Type override for webhook raw mode |

**Webhook-specific notes:**
- `payloadMode`: "envelope" (default) or "raw"
- `json`: raw request body (auto-enables raw mode if provided; required for body-carrying raw methods)
- `method`: HTTP method override for raw mode (GET, HEAD, POST, PUT, PATCH, DELETE)
- `contentType`: Content-Type override for raw mode (applies only when a request body is sent)
- GET/HEAD raw requests are bodyless (do not provide `json`)

## Commands

| Command | Description |
|---------|-------------|
| `/chat-bridge` | Show bridge status (sessions, queue, active prompts) |
| `/chat-bridge on` | Start the chat bridge |
| `/chat-bridge off` | Stop the chat bridge |
| `/scheduler` | Show scheduler status (jobs, schedules, run counts) |
| `/scheduler run <job>` | Manually run a scheduled job |

**Built-in bot commands (when bridge commands enabled):**

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Show available commands |
| `/abort` | Cancel the current prompt |
| `/status` | Show session info (mode, state, messages, queue, uptime) |
| `/new` | Clear queue and start fresh conversation |

## Event API

Extensions can interact with pi-bridge via events:

**Emitted events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `bridge:receive` | `IncomingMessage` | Incoming message from an external adapter |
| `cron:job_complete` | `{ job, response, ok, error, durationMs }` | Scheduler job finished |

**Listened events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `bridge:send` | `ChannelMessage & { callback? }` | Send a message via an adapter |
| `bridge:register` | `{ name, adapter, callback? }` | Register a custom adapter |
| `bridge:remove` | `{ name, callback? }` | Remove an adapter |
| `bridge:list` | `{ callback }` | List adapters + routes |
| `bridge:test` | `{ adapter, recipient, callback? }` | Test an adapter with a ping |
| `cron:job_complete` | (from scheduler) | Auto-routes cron output to channels |

## Custom Adapters

Register custom adapters at runtime via the event bus:

```typescript
pi.events.emit("bridge:register", {
  name: "my-adapter",
  adapter: {
    direction: "bidirectional",
    async send(message) {
      // Send message to your service
    },
    async start(onMessage) {
      // Start listening for incoming messages
      // Call onMessage() when you receive something
    },
    async stop() {
      // Cleanup
    },
    async sendTyping(recipient) {
      // Optional: send typing indicator
    },
    createStream(recipient, config) {
      // Optional: return StreamHandle for streaming
    }
  },
  callback: (ok) => console.log("Registered:", ok)
});
```

**ChannelAdapter interface:**

```typescript
interface ChannelAdapter {
  direction: "outgoing" | "incoming" | "bidirectional";
  send?(message: ChannelMessage): Promise<void>;
  start?(onMessage: OnIncomingMessage): Promise<void>;
  stop?(): Promise<void>;
  sendTyping?(recipient: string): Promise<void>;
  syncBotCommands?(commands: Array<{ command: string; description: string }>): Promise<void>;
  createStream?(recipient: string, config?: { throttleMs?: number; minChars?: number }): StreamHandle;
}
```

## Testing

```bash
npm test
```

## License

MIT
