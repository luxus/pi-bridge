/**
 * pi-bridge — Two-way channel extension for pi.
 *
 * Routes messages between agents and external services
 * (Telegram, webhooks, custom adapters).
 *
 * Built-in adapters: telegram (bidirectional), webhook (outgoing)
 * Custom adapters: register via pi.events.emit("bridge:register", ...)
 *
 * Chat bridge: when enabled, incoming messages are routed to the agent
 * as isolated subprocess prompts and responses are sent back. Enable via:
 *   - --chat-bridge flag
 *   - /chat-bridge on command
 *   - settings.json: { "pi-bridge": { "bridge": { "enabled": true } } }
 *
 * Config in settings.json under "pi-bridge":
 * {
 *   "pi-bridge": {
 *     "adapters": {
 *       "telegram": { "type": "telegram", "botToken": "your-telegram-bot-token", "polling": true }
 *     },
 *     "routes": {
 *       "ops": { "adapter": "telegram", "recipient": "-100987654321" }
 *     },
 *     "bridge": {
 *       "enabled": false,
 *       "maxQueuePerSender": 5,
 *       "timeoutMs": 300000,
 *       "maxConcurrent": 2,
 *       "typingIndicators": true,
 *       "commands": true
 *     }
 *   }
 * }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { ChannelRegistry } from "./registry.ts";
import { registerBridgeEvents, setBridge } from "./events.ts";
import { registerBridgeTool } from "./tool.ts";
import { ChatBridge } from "./bridge/bridge.ts";
import { getAllCommands } from "./bridge/commands.ts";
import { createLogger } from "./logger.ts";
import { initChatHistory } from "./chat-history.ts";
import { Scheduler } from "./scheduler/scheduler.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	const registry = new ChannelRegistry();
	registry.setLogger(log);
	let bridge: ChatBridge | null = null;
	let scheduler: Scheduler | null = null;

	// ── Flag: --chat-bridge ───────────────────────────────────

	pi.registerFlag("chat-bridge", {
		description: "Enable the chat bridge on startup (incoming messages → agent → reply)",
		type: "boolean",
		default: false,
	});

	// ── Event API + cron integration ──────────────────────────

	registerBridgeEvents(pi, registry);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		initChatHistory(ctx.cwd);
		registry.setModelRegistry(ctx.modelRegistry);
		registry.setEvents(pi.events);
		await registry.loadConfig(config, ctx.cwd);

		const errors = registry.getErrors();
		for (const err of errors) {
			ctx.ui.notify(`pi-bridge: ${err.adapter}: ${err.error}`, "warning");
			log("adapter-error", { adapter: err.adapter, error: err.error }, "ERROR");
		}
		log("init", { adapters: Object.keys(config.adapters ?? {}), routes: Object.keys(config.routes ?? {}) });

		// Start incoming/bidirectional adapters
		await registry.startListening();

		// Sync bot commands with platforms (e.g. Telegram /command menu)
		const botCommands = getAllCommands().map(c => ({ command: c.name, description: c.description }));
		await registry.syncBotCommands(botCommands);

		const startErrors = registry.getErrors().filter(e => e.error.startsWith("Failed to start"));
		for (const err of startErrors) {
			ctx.ui.notify(`pi-bridge: ${err.adapter}: ${err.error}`, "warning");
		}

		// Initialize bridge
		bridge = new ChatBridge(config.bridge, ctx.cwd, registry, pi.events, log);
		setBridge(bridge);

		const flagEnabled = pi.getFlag("--chat-bridge");
		if (flagEnabled || config.bridge?.enabled) {
			bridge.start();
			log("bridge-start", {});
			ctx.ui.notify("pi-bridge: Chat bridge started", "info");
		}

		// Initialize scheduler
		if (config.scheduler?.enabled && config.scheduler?.jobs) {
			scheduler = new Scheduler(config.scheduler, ctx.cwd, registry, pi.events, log);
			scheduler.start();
			log("scheduler-start", { jobs: Object.keys(config.scheduler.jobs) });
		}
	});

	pi.on("session_shutdown", async () => {
		if (bridge?.isActive()) log("bridge-stop", {});
		bridge?.stop();
		setBridge(null);
		scheduler?.stop();
		scheduler = null;
		await registry.stopAll();
	});

	// ── Command: /chat-bridge ─────────────────────────────────

	pi.registerCommand("chat-bridge", {
		description: "Manage chat bridge: /chat-bridge [on|off|status]",
		getArgumentCompletions: (prefix: string) => {
			return ["on", "off", "status"]
				.filter(c => c.startsWith(prefix))
				.map(c => ({ value: c, label: c }));
		},
		handler: async (args, ctx) => {
			const cmd = args?.trim().toLowerCase();

			if (cmd === "on") {
				if (!bridge) {
					ctx.ui.notify("Chat bridge not initialized — no channel config?", "warning");
					return;
				}
				if (bridge.isActive()) {
					ctx.ui.notify("Chat bridge is already running.", "info");
					return;
				}
				bridge.start();
				ctx.ui.notify("✓ Chat bridge started", "info");
				return;
			}

			if (cmd === "off") {
				if (!bridge?.isActive()) {
					ctx.ui.notify("Chat bridge is not running.", "info");
					return;
				}
				bridge.stop();
				ctx.ui.notify("✓ Chat bridge stopped", "info");
				return;
			}

			// Default: status
			if (!bridge) {
				ctx.ui.notify("Chat bridge: not initialized", "info");
				return;
			}

			const stats = bridge.getStats();
			const lines = [
				`Chat bridge: ${stats.active ? "🟢 Active" : "⚪ Inactive"}`,
				`Sessions: ${stats.sessions}`,
				`Active prompts: ${stats.activePrompts}`,
				`Queued: ${stats.totalQueued}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── Command: /scheduler ───────────────────────────────────

	pi.registerCommand("scheduler", {
		description: "Manage scheduler: /scheduler [status|run <job>]",
		getArgumentCompletions: (prefix: string) => {
			const cmds = ["status", "run"];
			return cmds
				.filter(c => c.startsWith(prefix))
				.map(c => ({ value: c, label: c }));
		},
		handler: async (args, ctx) => {
			if (!scheduler) {
				ctx.ui.notify("Scheduler not initialized", "warning");
				return;
			}
			const parts = args?.trim().split(/\s+/) ?? [];
			if (parts[0] === "run" && parts[1]) {
				const result = await scheduler.runJob(parts[1]);
				ctx.ui.notify(result ? `✓ Job "${parts[1]}" completed` : `❌ Job "${parts[1]}" not found`, result ? "info" : "warning");
				return;
			}
			// Status
			const stats = scheduler.getStats();
			const lines = stats.map(j => `${j.enabled ? "🟢" : "⚪"} ${j.name}: ${j.schedule} → ${j.channel} (runs: ${j.runCount}${j.lastRun ? `, last: ${new Date(j.lastRun).toLocaleTimeString()}` : ""})`);
			ctx.ui.notify(lines.length ? lines.join("\n") : "No jobs configured", "info");
		},
	});

	// ── LLM tool ──────────────────────────────────────────────

	registerBridgeTool(pi, registry);
}
