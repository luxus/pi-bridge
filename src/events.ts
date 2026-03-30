/**
 * pi-bridge — Event API registration.
 *
 * Events emitted:
 *   bridge:receive  — incoming message from an external adapter
 *
 * Events listened to:
 *   cron:job_complete — auto-routes cron output to channels
 *   bridge:send      — send a message via an adapter
 *   bridge:register  — register a custom adapter
 *   bridge:remove    — remove an adapter
 *   bridge:list      — list adapters + routes
 *   bridge:test      — test an adapter with a ping
 *   bridge:*          — chat bridge lifecycle events
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ChannelRegistry } from "./registry.ts";
import type { ChannelAdapter, ChannelMessage, IncomingMessage } from "./types.ts";
import type { ChatBridge } from "./bridge/bridge.ts";

/** Reference to the active bridge, set by index.ts after construction. */
let activeBridge: ChatBridge | null = null;

export function setBridge(bridge: ChatBridge | null): void {
	activeBridge = bridge;
}

export function registerBridgeEvents(pi: ExtensionAPI, registry: ChannelRegistry): void {

	// ── Incoming messages → bridge:receive (+ bridge) ──────

	registry.setOnIncoming((message: IncomingMessage) => {
		pi.events.emit("bridge:receive", message);

		// Route to bridge if active
		if (activeBridge?.isActive()) {
			activeBridge.handleMessage(message);
		} else {
		}
	});

	// ── Auto-route cron job output ──────────────────────────

	pi.events.on("cron:job_complete", (raw: unknown) => {
		const event = raw as {
			job: { name: string; channel: string; prompt: string };
			response?: string;
			ok: boolean;
			error?: string;
			durationMs: number;
		};

		if (!event.job.channel) return;
		if (!event.response && !event.error) return;

		const text = event.ok
			? event.response ?? "(no output)"
			: `❌ Error: ${event.error ?? "unknown"}`;

		registry.send({
			adapter: event.job.channel,
			recipient: "",
			text,
			source: `cron:${event.job.name}`,
			metadata: { durationMs: event.durationMs, ok: event.ok },
		});
	});

	// ── bridge:send — deliver a message ─────────────────────

	pi.events.on("bridge:send", (raw: unknown) => {
		const data = raw as ChannelMessage & { callback?: (result: { ok: boolean; error?: string }) => void };
		registry.send(data).then(r => data.callback?.(r));
	});

	// ── bridge:register — add a custom adapter ──────────────

	pi.events.on("bridge:register", (raw: unknown) => {
		const data = raw as { name: string; adapter: ChannelAdapter; callback?: (ok: boolean) => void };
		if (!data.name || !data.adapter) {
			data.callback?.(false);
			return;
		}
		registry.register(data.name, data.adapter);
		data.callback?.(true);
	});

	// ── bridge:remove — remove an adapter ───────────────────

	pi.events.on("bridge:remove", (raw: unknown) => {
		const data = raw as { name: string; callback?: (ok: boolean) => void };
		data.callback?.(registry.unregister(data.name));
	});

	// ── bridge:list — list adapters + routes ────────────────

	pi.events.on("bridge:list", (raw: unknown) => {
		const data = raw as { callback?: (items: ReturnType<ChannelRegistry["list"]>) => void };
		data.callback?.(registry.list());
	});

	// ── bridge:test — send a test ping ──────────────────────

	pi.events.on("bridge:test", (raw: unknown) => {
		const data = raw as { adapter: string; recipient: string; callback?: (result: { ok: boolean; error?: string }) => void };
		registry.send({
			adapter: data.adapter,
			recipient: data.recipient ?? "",
			text: `🏓 pi-bridge test — ${new Date().toISOString()}`,
			source: "bridge:test",
		}).then(r => data.callback?.(r));
	});
}
