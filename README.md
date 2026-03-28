# pi-bridge

Multi-platform messaging bridge for Pi — bidirectional Telegram, SendBlue (iMessage/SMS/RCS), and Discord integrations with streaming text support.

## Features

- **Telegram** — Bidirectional messaging with streaming text updates (real-time typing effect)
- **SendBlue** — iMessage, SMS, and RCS via SendBlue API with webhook support
- **Discord** — Bot integration with slash commands (planned)
- **Chat Bridge** — Route incoming messages to Pi agents with responses streamed back
- **Streaming** — Real-time text streaming similar to OpenClaw

## Installation

```bash
pi install github:luxus/pi-bridge
```

Or for local development:
```bash
cd ~/.pi/agent/extensions
ln -s ~/dev/pi-bridge pi-bridge
```

## Configuration

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-bridge": {
    "adapters": {
      "telegram": {
        "type": "telegram",
        "botToken": "your-telegram-bot-token",
        "polling": true,
        "streaming": true
      },
      "sendblue": {
        "type": "sendblue",
        "apiKeyId": "env:SENDBLUE_API_KEY_ID",
        "apiSecret": "env:SENDBLUE_API_SECRET",
        "webhookPath": "/webhook/sendblue",
        "sendblueNumber": "+1234567890"
      }
    },
    "bridge": {
      "enabled": false,
      "streaming": true,
      "typingIndicators": true
    }
  }
}
```

## Commands

| Command | Description |
|---------|-------------|
| `/chat-bridge` | Show bridge status |
| `/chat-bridge on` | Start the chat bridge |
| `/chat-bridge off` | Stop the chat bridge |
| `/notify` | Send messages via configured adapters |

## License

MIT
