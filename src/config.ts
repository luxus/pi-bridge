/**
 * pi-bridge — Config from pi SettingsManager.
 *
 * Reads the "pi-bridge" key from settings via SettingsManager,
 * which merges global (~/.pi/agent/settings.json) and project
 * (.pi/settings.json) configs automatically.
 *
 * Environment variable overrides (highest priority, override settings.json):
 *   - TELEGRAM_BOT_TOKEN    → adapters.telegram.botToken
 *   - WEBHOOK_SECRET        → adapters.webhook.secret
 *   - SENDBLUE_API_KEY_ID   → adapters.sendblue.apiKeyId
 *   - SENDBLUE_API_SECRET   → adapters.sendblue.apiSecret
 *   - SENDBLUE_NUMBER       → adapters.sendblue.sendblueNumber
 *
 * Example settings.json:
 * {
 *   "pi-bridge": {
 *     "adapters": {
 *       "telegram": {
 *         "type": "telegram",
 *         "botToken": "your-telegram-bot-token",
 *         "streaming": true
 *       },
 *       "sendblue": {
 *         "type": "sendblue",
 *         "apiKeyId": "env:SENDBLUE_API_KEY_ID",
 *         "apiSecret": "env:SENDBLUE_API_SECRET",
 *         "sendblueNumber": "+1234567890"
 *       }
 *     },
 *     "routes": {
 *       "ops": { "adapter": "telegram", "recipient": "-100987654321" }
 *     },
 *     "bridge": {
 *       "enabled": false,
 *       "streaming": true
 *     }
 *   }
 * }
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { ChannelConfig } from "./types.ts";

const SETTINGS_KEY = "pi-bridge";

export function loadConfig(cwd: string): ChannelConfig {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;

	const globalCh = global?.[SETTINGS_KEY] ?? {};
	const projectCh = project?.[SETTINGS_KEY] ?? {};

	// Project overrides global (shallow merge of adapters + routes + bridge)
	const merged: ChannelConfig = {
		adapters: {
			...(globalCh.adapters ?? {}),
			...(projectCh.adapters ?? {}),
		} as ChannelConfig["adapters"],
		routes: {
			...(globalCh.routes ?? {}),
			...(projectCh.routes ?? {}),
		},
		bridge: {
			...(globalCh.bridge ?? {}),
			...(projectCh.bridge ?? {}),
		} as ChannelConfig["bridge"],
	};

	// Env vars override settings.json values
	applyEnvOverrides(merged);

	return merged;
}

/**
 * Apply environment variable overrides to the merged config.
 *
 * Env vars take highest priority, overriding any value from settings.json.
 *
 *   TELEGRAM_BOT_TOKEN    → adapters.telegram.botToken
 *   WEBHOOK_SECRET        → adapters.webhook.secret
 *   SENDBLUE_API_KEY_ID   → adapters.sendblue.apiKeyId
 *   SENDBLUE_API_SECRET   → adapters.sendblue.apiSecret
 *   SENDBLUE_NUMBER       → adapters.sendblue.sendblueNumber
 *
 * Adapter entries are auto-created with a default type if they don't already exist
 * in settings, so you can run purely from env vars without any settings.json config.
 */
function applyEnvOverrides(config: ChannelConfig): void {
	const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
	if (telegramToken) {
		if (!config.adapters.telegram) {
			config.adapters.telegram = { type: "telegram" };
		}
		config.adapters.telegram.botToken = telegramToken;
	}

	const webhookSecret = process.env.WEBHOOK_SECRET;
	if (webhookSecret) {
		if (!config.adapters.webhook) {
			config.adapters.webhook = { type: "webhook" };
		}
		config.adapters.webhook.secret = webhookSecret;
	}

	// SendBlue overrides
	const sendblueKeyId = process.env.SENDBLUE_API_KEY_ID;
	const sendblueSecret = process.env.SENDBLUE_API_SECRET;
	const sendblueNumber = process.env.SENDBLUE_NUMBER;
	if (sendblueKeyId || sendblueSecret || sendblueNumber) {
		if (!config.adapters.sendblue) {
			config.adapters.sendblue = { type: "sendblue" };
		}
		if (sendblueKeyId) config.adapters.sendblue.apiKeyId = sendblueKeyId;
		if (sendblueSecret) config.adapters.sendblue.apiSecret = sendblueSecret;
		if (sendblueNumber) config.adapters.sendblue.sendblueNumber = sendblueNumber;
	}
}

/**
 * Read a setting from the "pi-bridge" config by dotted key path.
 * Useful for adapter-specific secrets that shouldn't live in the adapter config block.
 *
 * Example: getChannelSetting(cwd, "slack.appToken") reads pi-bridge.slack.appToken
 */
export function getChannelSetting(cwd: string, keyPath: string): unknown {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;

	const globalCh = global?.[SETTINGS_KEY] ?? {};
	const projectCh = project?.[SETTINGS_KEY] ?? {};

	// Walk the dotted path independently in each scope to avoid
	// shallow-merge dropping sibling keys from nested objects.
	function walk(obj: any): unknown {
		let current: any = obj;
		for (const part of keyPath.split(".")) {
			if (current == null || typeof current !== "object") return undefined;
			current = current[part];
		}
		return current;
	}

	// Project overrides global at the leaf level.
	// Use explicit undefined check so null can be used to unset a global default.
	const projectValue = walk(projectCh);
	return projectValue !== undefined ? projectValue : walk(globalCh);
}
