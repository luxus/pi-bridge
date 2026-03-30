/**
 * pi-bridge — Chat bridge.
 *
 * Listens for incoming messages (bridge:receive), serializes per sender,
 * runs prompts via isolated subprocesses, and sends responses back via
 * the same adapter. Each sender gets their own FIFO queue. Multiple
 * senders run concurrently up to maxConcurrent.
 */

import type {
	IncomingMessage,
	IncomingAttachment,
	QueuedPrompt,
	SenderSession,
	BridgeConfig,
	StreamHandle,
	SecurityConfig,
} from "../types.ts";
import type { ChannelRegistry } from "../registry.ts";
import type { EventBus } from "@mariozechner/pi-coding-agent";
import { runPrompt } from "./runner.ts";
import { RpcSessionManager } from "./rpc-runner.ts";
import { isCommand, handleCommand, type CommandContext } from "./commands.ts";
import { startTyping } from "./typing.ts";
import { saveIncomingMessage, saveAssistantResponse, getRecentContext, formatContextForPrompt } from "../chat-history.ts";
import { ToolProxy } from "./tool-proxy.ts";

const BRIDGE_DEFAULTS: Required<BridgeConfig> = {
	enabled: false,
	sessionMode: "persistent",
	sessionRules: [],
	idleTimeoutMinutes: 30,
	maxQueuePerSender: 5,
	timeoutMs: 300_000,
	maxConcurrent: 2,
	model: null,
	typingIndicators: true,
	commands: true,
	streaming: false,
	streamingThrottleMs: 500,
	streamingMinChars: 30,
	extensions: [],
};

type LogFn = (event: string, data: unknown, level?: string) => void;

let idCounter = 0;
function nextId(): string {
	return `msg-${Date.now()}-${++idCounter}`;
}

export class ChatBridge {
	private config: Required<BridgeConfig>;
	private securityConfig: SecurityConfig | undefined;
	private cwd: string;
	private registry: ChannelRegistry;
	private events: EventBus;
	private log: LogFn;
	private sessions = new Map<string, SenderSession>();
	private activeCount = 0;
	private running = false;
	private rpcManager: RpcSessionManager | null = null;
	private toolProxy: ToolProxy | null = null;

	constructor(
		bridgeConfig: BridgeConfig | undefined,
		securityConfig: SecurityConfig | undefined,
		cwd: string,
		registry: ChannelRegistry,
		events: EventBus,
		log: LogFn = () => {},
	) {
		this.config = { ...BRIDGE_DEFAULTS, ...bridgeConfig };
		this.securityConfig = securityConfig;
		this.cwd = cwd;
		this.registry = registry;
		this.events = events;
		this.log = log;
	}

	// ── Lifecycle ─────────────────────────────────────────────

	start(): void {
		if (this.running) return;
		this.running = true;

		// Always create the RPC manager — it's used on-demand for persistent senders
		this.rpcManager = new RpcSessionManager(
			{
				cwd: this.cwd,
				model: this.config.model,
				timeoutMs: this.config.timeoutMs,
				extensions: this.config.extensions,
			},
			this.config.idleTimeoutMinutes * 60_000,
		);

		// Initialize tool proxy for trusted user system
		this.toolProxy = new ToolProxy(
			this.securityConfig,
			{
				cwd: this.cwd,
				timeoutMs: this.config.timeoutMs,
				model: this.config.model,
				log: this.log,
			},
		);
	}

	stop(): void {
		this.running = false;
		for (const session of this.sessions.values()) {
			session.abortController?.abort();
		}
		this.sessions.clear();
		this.activeCount = 0;
		this.rpcManager?.killAll();
		this.rpcManager = null;
		this.toolProxy = null;
	}

	isActive(): boolean {
		return this.running;
	}

	updateConfig(cfg: BridgeConfig, securityCfg?: SecurityConfig): void {
		this.config = { ...BRIDGE_DEFAULTS, ...cfg };
		if (securityCfg !== undefined) {
			this.securityConfig = securityCfg;
			this.toolProxy?.updateConfig(securityCfg);
		}
	}

	// ── Main entry point ──────────────────────────────────────

	async handleMessage(message: IncomingMessage): Promise<void> {
		if (!this.running) {
			return;
		}

		const text = message.text?.trim();
		const hasAttachments = message.attachments && message.attachments.length > 0;
		if (!text && !hasAttachments) {
			return;
		}

		// Detect if user requested voice message
		const voiceRequested = text ? this.detectVoiceRequest(text) : false;

		// Rejected messages (too large, unsupported type) — send back directly
		if (message.metadata?.rejected) {
			this.sendReply(message.adapter, message.sender, text || "⚠️ Unsupported message.", voiceRequested);
			return;
		}

		const senderKey = `${message.adapter}:${message.sender}`;

		// Add trust metadata
		const isTrusted = this.toolProxy?.isTrusted(message.sender) ?? false;
		message.metadata = {
			...message.metadata,
			isTrusted,
			trustLevel: isTrusted ? "trusted" : "untrusted",
			voiceRequested,
		};

		// Check for direct tool invocations (e.g., "/read file.txt")
		if (text && text.startsWith("/")) {
			const toolResult = await this.handleToolInvocation(text, message);
			if (toolResult) {
				// Tool was handled (either executed or permission denied)
				if (!toolResult.ok) {
					this.sendReply(message.adapter, message.sender, `❌ ${toolResult.error || "Tool execution failed"}`);
				} else {
					this.sendReply(message.adapter, message.sender, toolResult.response || "✓ Done");
				}
				return;
			}
		}

		// Get or create session
		let session = this.sessions.get(senderKey);
		if (!session) {
			session = this.createSession(message);
			this.sessions.set(senderKey, session);
		} else {
		}

		// Bot commands (only for text-only messages)
		if (text && !hasAttachments && this.config.commands && isCommand(text)) {
			const reply = handleCommand(text, session, this.commandContext());
			if (reply !== null) {
				this.sendReply(message.adapter, message.sender, reply);
				return;
			}
			// Unrecognized command — fall through to agent
		}

		// Queue depth check
		if (session.queue.length >= this.config.maxQueuePerSender) {
			this.sendReply(
				message.adapter,
				message.sender,
				`⚠️ Queue full (${this.config.maxQueuePerSender} pending). ` +
				`Wait for current prompts to finish or use /abort.`,
			);
			return;
		}

		// Save to chat history
		saveIncomingMessage(message);

		// Enqueue
		const queued: QueuedPrompt = {
			id: nextId(),
			adapter: message.adapter,
			sender: message.sender,
			text: text || "Describe this.",
			attachments: message.attachments,
			metadata: message.metadata,
			enqueuedAt: Date.now(),
		};
		session.queue.push(queued);
		session.messageCount++;

		this.events.emit("bridge:enqueue", {
			id: queued.id, adapter: message.adapter, sender: message.sender,
			queueDepth: session.queue.length,
		});

		this.processNext(senderKey);
	}

	// ── Processing ────────────────────────────────────────────

	private async processNext(senderKey: string): Promise<void> {
		const session = this.sessions.get(senderKey);
		if (!session) {
			return;
		}
		if (session.processing) {
			return;
		}
		if (session.queue.length === 0) {
			return;
		}
		if (this.activeCount >= this.config.maxConcurrent) {
			return;
		}

		session.processing = true;
		this.activeCount++;
		const prompt = session.queue.shift()!;

		const adapter = this.registry.getAdapter(prompt.adapter);
		if (!adapter) {
			this.sendReply(prompt.adapter, prompt.sender, "❌ Adapter not found.");
			session.processing = false;
			this.activeCount--;
			return;
		}
		const typing = this.config.typingIndicators
			? startTyping(adapter, prompt.sender)
			: { stop() {} };

		const ac = new AbortController();
		session.abortController = ac;

		const hasDocuments = prompt.attachments?.some(att => att.type === "document") ?? false;
		let usePersistent = this.shouldUsePersistent(senderKey);
		// Force stateless mode for documents (RPC doesn't support document type)
		if (hasDocuments) usePersistent = false;

		// Get chat context for this sender
		const recentContext = getRecentContext(prompt.sender);
		const contextText = formatContextForPrompt(recentContext);
		
		// Build sender context header for the agent
		const senderName = prompt.metadata?.firstName || prompt.metadata?.username || "User";
		const senderId = prompt.sender;
		const senderContext = `[Message from ${senderName} (ID: ${senderId}) via ${prompt.adapter}]`;
		
		const originalText = prompt.text;
		const promptWithContext = contextText + "\n" + senderContext + "\n\n" + originalText;
		prompt.text = promptWithContext;

		const voiceRequested = prompt.metadata?.voiceRequested === true;
		
		// Disable streaming for voice messages (TTS requires complete text)
		const useStreaming = !voiceRequested && this.config.streaming && typeof adapter.createStream === "function";
		let stream: StreamHandle | null = null;
		let streamedText = "";

		if (useStreaming) {
			stream = adapter.createStream!(prompt.sender, {
				throttleMs: this.config.streamingThrottleMs,
				minChars: this.config.streamingMinChars,
			});
		}

		const onStreamingChunk = (delta: string) => {
			if (!stream || !stream.isActive()) return;
			streamedText += delta;
			stream.update(streamedText);
		};

		this.events.emit("bridge:start", {
			id: prompt.id, adapter: prompt.adapter, sender: prompt.sender,
			text: promptWithContext.slice(0, 100),
			persistent: usePersistent,
			streaming: useStreaming,
		});

		try {
			let result: import("../types.ts").RunResult;

			if (usePersistent && this.rpcManager) {
				result = await this.runWithRpc(senderKey, prompt, ac.signal, stream ? onStreamingChunk : undefined);
			} else {
				result = await runPrompt({
					prompt: promptWithContext,
					cwd: this.cwd,
					timeoutMs: this.config.timeoutMs,
					model: this.config.model,
					signal: ac.signal,
					attachments: prompt.attachments,
					extensions: this.config.extensions,
					onData: stream ? onStreamingChunk : undefined,
					sender: prompt.sender,
					metadata: prompt.metadata,
				});
			}

			typing.stop();

		if (result.ok) {
			saveAssistantResponse(prompt.sender, result.response, prompt.adapter);
			const voiceRequested = prompt.metadata?.voiceRequested === true;
			if (stream && stream.isActive()) {
			streamedText = result.response;
			stream.update(streamedText);
				await stream.finalize();
			} else {
				this.sendReply(prompt.adapter, prompt.sender, result.response, voiceRequested);
			}
		} else if (result.error === "Aborted by user") {
			if (stream && stream.isActive()) {
				await stream.abort(true);
			}
			this.sendReply(prompt.adapter, prompt.sender, "⏹ Aborted.");
		} else {
			if (stream && stream.isActive()) {
				await stream.abort(true);
			}
			const userError = sanitizeError(result.error);
			this.sendReply(
				prompt.adapter, prompt.sender,
				result.response || `❌ ${userError}`,
			);
		}

			this.events.emit("bridge:complete", {
				id: prompt.id, adapter: prompt.adapter, sender: prompt.sender,
				ok: result.ok, durationMs: result.durationMs,
				persistent: usePersistent, streaming: useStreaming,
			});
			this.log("bridge-complete", {
				id: prompt.id, adapter: prompt.adapter, ok: result.ok,
				durationMs: result.durationMs, persistent: usePersistent,
				streaming: useStreaming,
			}, result.ok ? "INFO" : "WARN");

		} catch (err: any) {
			typing.stop();
			if (stream && stream.isActive()) {
				await stream.abort(true);
			}
			this.log("bridge-error", { adapter: prompt.adapter, sender: prompt.sender, error: err.message }, "ERROR");
			this.sendReply(prompt.adapter, prompt.sender, `❌ Unexpected error: ${err.message}`);
		} finally {
			session.abortController = null;
			session.processing = false;
			this.activeCount--;

			if (session.queue.length > 0) this.processNext(senderKey);
			this.drainWaiting();
		}
	}

	/** Run a prompt via persistent RPC session. */
	private async runWithRpc(
		senderKey: string,
		prompt: QueuedPrompt,
		signal?: AbortSignal,
		onStreaming?: (delta: string) => void,
	): Promise<import("../types.ts").RunResult> {
		try {
			const rpcSession = await this.rpcManager!.getSession(senderKey);
			return await rpcSession.runPrompt(prompt.text, {
				signal,
				attachments: prompt.attachments,
				onStreaming,
				sender: prompt.sender,
				metadata: prompt.metadata,
			});
		} catch (err: any) {
			return {
				ok: false,
				response: "",
				error: err.message,
				durationMs: 0,
				exitCode: 1,
			};
		}
	}

	/** After a slot frees up, check other senders waiting for concurrency. */
	private drainWaiting(): void {
		if (this.activeCount >= this.config.maxConcurrent) return;
		for (const [key, session] of this.sessions) {
			if (!session.processing && session.queue.length > 0) {
				this.processNext(key);
				if (this.activeCount >= this.config.maxConcurrent) break;
			}
		}
	}

	// ── Session management ────────────────────────────────────

	private createSession(message: IncomingMessage): SenderSession {
		return {
			adapter: message.adapter,
			sender: message.sender,
			displayName:
				(message.metadata?.firstName as string) ||
				(message.metadata?.username as string) ||
				message.sender,
			queue: [],
			processing: false,
			abortController: null,
			messageCount: 0,
			startedAt: Date.now(),
		};
	}

	getStats(): {
		active: boolean;
		sessions: number;
		activePrompts: number;
		totalQueued: number;
	} {
		let totalQueued = 0;
		for (const s of this.sessions.values()) totalQueued += s.queue.length;
		return {
			active: this.running,
			sessions: this.sessions.size,
			activePrompts: this.activeCount,
			totalQueued,
		};
	}

	getSessions(): Map<string, SenderSession> {
		return this.sessions;
	}

	// ── Session mode resolution ───────────────────────────────

	/**
	 * Determine if a sender should use persistent (RPC) or stateless mode.
	 * Checks sessionRules first (first match wins), falls back to sessionMode default.
	 */
	private shouldUsePersistent(senderKey: string): boolean {
		for (const rule of this.config.sessionRules) {
			if (globMatch(rule.match, senderKey)) {
				return rule.mode === "persistent";
			}
		}
		return this.config.sessionMode === "persistent";
	}

	// ── Command context ───────────────────────────────────────

	private commandContext(): CommandContext {
		return {
			isPersistent: (sender: string) => {
				// Find the sender key to check mode
				for (const [key, session] of this.sessions) {
					if (session.sender === sender) return this.shouldUsePersistent(key);
				}
				return this.config.sessionMode === "persistent";
			},
			abortCurrent: (sender: string): boolean => {
				for (const session of this.sessions.values()) {
					if (session.sender === sender && session.abortController) {
						session.abortController.abort();
						return true;
					}
				}
				return false;
			},
			clearQueue: (sender: string): void => {
				for (const session of this.sessions.values()) {
					if (session.sender === sender) session.queue.length = 0;
				}
			},
			resetSession: (sender: string): void => {
				for (const [key, session] of this.sessions) {
					if (session.sender === sender) {
						this.sessions.delete(key);
						// Also reset persistent RPC session
						if (this.rpcManager) {
							this.rpcManager.resetSession(key).catch(() => {});
						}
					}
				}
			},
		};
	}

	// ── Voice detection ──────────────────────────────────────

	private detectVoiceRequest(text: string): boolean {
		const voicePatterns = [
			/sprachnachricht/i,
			/voice message/i,
			/als voice/i,
			/als sprache/i,
			/per voice/i,
			/per sprachnachricht/i,
			/send.*als.*voice/i,
			/send.*als.*sprache/i,
			/antworte.*voice/i,
			/antworte.*sprach/i,
			/kannst du.*voice/i,
			/kannst du.*sprach/i,
		];
		return voicePatterns.some(pattern => pattern.test(text));
	}

	// ── Reply ─────────────────────────────────────────────────

	private sendReply(adapter: string, recipient: string, text: string, voiceRequested: boolean = false): void {
		if (voiceRequested) {
			this.registry.send({ 
				adapter, 
				recipient, 
				text,
				metadata: { voice: true }
			});
		} else {
			this.registry.send({ adapter, recipient, text });
		}
	}

	// ── Tool invocation handling ──────────────────────────────

	/**
	 * Handle direct tool invocations from messages.
	 * Returns null if not a tool invocation, or ToolResult if handled.
	 */
	private async handleToolInvocation(
		text: string,
		message: IncomingMessage,
	): Promise<import("./tool-proxy.ts").ToolResult | null> {
		if (!this.toolProxy) return null;

		// Parse tool command: /tool arg1 arg2...
		const match = text.match(/^\/([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(.*))?$/);
		if (!match) return null;

		const tool = match[1];
		const argsStr = match[2] || "";
		const args = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];

		// List of tools we handle directly
		const knownTools = ["read", "write", "shell", "web_search", "notify", "tts"];
		if (!knownTools.includes(tool)) {
			// Might be a skill - let the agent handle it
			return null;
		}

		// Execute the tool
		return this.toolProxy.executeTool(tool, args, {
			sender: message.sender,
			adapter: message.adapter,
			metadata: message.metadata,
		});
	}
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Simple glob matcher supporting `*` (any chars) and `?` (single char).
 * Used for sessionRules pattern matching against "adapter:senderId" keys.
 */
function globMatch(pattern: string, text: string): boolean {
	// Escape regex special chars except * and ?
	const re = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${re}$`).test(text);
}

const MAX_ERROR_LENGTH = 200;

/**
 * Sanitize subprocess error output for end-user display.
 * Strips stack traces, extension crash logs, and long technical details.
 */
function sanitizeError(error: string | undefined): string {
	if (!error) return "Something went wrong. Please try again.";

	// Extract the most meaningful line — skip "Extension error" noise and stack traces
	const lines = error.split("\n").filter(l => l.trim());

	// Find the first line that isn't an extension loading error or stack frame
	const meaningful = lines.find(l =>
		!l.startsWith("Extension error") &&
		!l.startsWith("    at ") &&
		!l.startsWith("node:") &&
		!l.includes("NODE_MODULE_VERSION") &&
		!l.includes("compiled against a different") &&
		!l.includes("Emitted 'error' event")
	);

	const msg = meaningful?.trim() || "Something went wrong. Please try again.";

	return msg.length > MAX_ERROR_LENGTH
		? msg.slice(0, MAX_ERROR_LENGTH) + "…"
		: msg;
}
