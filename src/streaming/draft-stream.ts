/**
 * pi-bridge — Streaming infrastructure for real-time message updates.
 *
 * Inspired by OpenClaw's draft-stream pattern. Provides:
 *   - editMessageText-based streaming for most platforms
 *   - sendMessageDraft support (Telegram Bot API 9.3+)
 *   - Throttled updates to avoid rate limits
 *   - Debounced initial sends (avoid flickering on short responses)
 *
 * Usage:
 *   const stream = createStream(api, chatId, { streaming: true });
 *   stream.update("Hello...");
 *   stream.update("Hello world!");
 *   await stream.flush();
 *   await stream.finalize(); // Convert to final message
 */

export interface StreamConfig {
	/** Enable streaming mode */
	streaming?: boolean;
	/** Throttle updates to every N ms (default: 500) */
	throttleMs?: number;
	/** Minimum chars before first send (default: 30, 0 = immediate) */
	minInitialChars?: number;
	/** Maximum message length before splitting (Telegram: 4096) */
	maxLength?: number;
	/** Parse mode for the platform (HTML, Markdown, etc) */
	parseMode?: string;
	/** Use sendMessageDraft instead of editMessageText (Telegram only) */
	useDraft?: boolean;
}

export interface StreamInstance {
	/** Append/update the stream content */
	update(text: string): void;
	/** Force immediate flush of pending updates */
	flush(): Promise<void>;
	/** Mark as complete and convert to final message */
	finalize(): Promise<void>;
	/** Abort the stream, optionally deleting the message */
	abort(deleteMessage?: boolean): Promise<void>;
	/** Get current content */
	getContent(): string;
	/** Check if streaming is active */
	isActive(): boolean;
}

/**
 * Create a streaming message handler.
 *
 * Platform-specific implementations should extend this base.
 */
export function createStream(
	config: StreamConfig & { sendFn?: (text: string, isFinal: boolean) => Promise<void> } = {}
): StreamInstance {
	const {
		streaming = true,
		throttleMs = 500,
		minInitialChars = 30,
		maxLength = 4096,
		sendFn,
	} = config;

	let content = "";
	let isComplete = false;
	let hasStarted = false;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let lastFlushTime = 0;

	const stream: StreamInstance = {
		update(text: string) {
			if (isComplete) {
				throw new Error("Cannot update completed stream");
			}
			content = text;

			if (!streaming || !sendFn) {
				return; // Non-streaming mode: accumulate only
			}

			// Debounce logic for first message
			if (!hasStarted && content.length < minInitialChars) {
				// Wait for more content before first send
				return;
			}

			// Throttle subsequent updates
			const now = Date.now();
			const timeSinceLastFlush = now - lastFlushTime;

			if (flushTimer) {
				clearTimeout(flushTimer);
			}

			if (timeSinceLastFlush >= throttleMs) {
				// Can send immediately
				stream.flush();
			} else {
				// Schedule delayed flush
				flushTimer = setTimeout(() => {
					stream.flush();
				}, throttleMs - timeSinceLastFlush);
			}
		},

		async flush(): Promise<void> {
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}

			if (!sendFn || !content) return;

			// Handle length limits
			let textToSend = content;
			if (textToSend.length > maxLength) {
				textToSend = textToSend.slice(0, maxLength - 3) + "...";
			}

			await sendFn(textToSend, false);
			lastFlushTime = Date.now();
			hasStarted = true;
		},

		async finalize(): Promise<void> {
			if (isComplete) return;
			isComplete = true;

			await stream.flush();

			if (sendFn) {
				await sendFn(content, true);
			}
		},

		async abort(deleteMessage = false): Promise<void> {
			isComplete = true;
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}
			// Platform-specific cleanup (delete message if supported)
			if (deleteMessage && sendFn) {
				// Note: delete support requires platform-specific implementation
			}
		},

		getContent(): string {
			return content;
		},

		isActive(): boolean {
			return !isComplete;
		},
	};

	return stream;
}

/**
 * Create a Telegram-specific streaming instance.
 *
 * Uses editMessageText for updates, with optional sendMessageDraft support.
 */
export function createTelegramStream(
	api: {
		sendMessage: (chatId: number | string, text: string, extra?: any) => Promise<{ message_id: number }>;
		editMessageText: (chatId: number | string, messageId: number, text: string, extra?: any) => Promise<any>;
		sendMessageDraft?: (chatId: number | string, draftId: number, text: string, extra?: any) => Promise<any>;
		deleteMessage?: (chatId: number | string, messageId: number) => Promise<any>;
	},
	chatId: number | string,
	config: StreamConfig & {
		/** Message thread ID for forum topics */
		messageThreadId?: number;
		/** Reply to message ID */
		replyToMessageId?: number;
	} = {}
): StreamInstance {
	const {
		streaming = true,
		throttleMs = 500,
		minInitialChars = 30,
		maxLength = 4096,
		parseMode,
		useDraft = false,
		messageThreadId,
		replyToMessageId,
	} = config;

	let content = "";
	let messageId: number | null = null;
	let draftId: number | null = null;
	let isComplete = false;
	let hasStarted = false;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let lastFlushTime = 0;
	let fallbackToMessage = false; // Set true if sendMessageDraft fails

	const extra: any = {};
	if (parseMode) extra.parse_mode = parseMode;
	if (messageThreadId) extra.message_thread_id = messageThreadId;

	async function sendInitial(text: string): Promise<void> {
		if (useDraft && api.sendMessageDraft && !fallbackToMessage) {
			// Use sendMessageDraft (Bot API 9.3+) - doesn't create visible message yet
			draftId = generateDraftId();
			try {
				await api.sendMessageDraft(chatId, draftId, text, extra);
				return;
			} catch (err: any) {
				// Fallback if sendMessageDraft not available
				if (err.message?.includes("sendMessageDraft")) {
					fallbackToMessage = true;
				}
			}
		}

		// Use regular sendMessage + editMessageText
		const sendExtra = { ...extra };
		if (replyToMessageId) {
			sendExtra.reply_to_message_id = replyToMessageId;
			sendExtra.allow_sending_without_reply = true;
		}

		const result = await api.sendMessage(chatId, text, sendExtra);
		messageId = result.message_id;
	}

	async function updateMessage(text: string): Promise<void> {
		if (draftId && api.sendMessageDraft && !fallbackToMessage) {
			// Update draft
			await api.sendMessageDraft(chatId, draftId, text, extra);
		} else if (messageId) {
			// Edit existing message
			await api.editMessageText(chatId, messageId, text, extra);
		}
	}

	return {
		update(text: string) {
			if (isComplete) {
				throw new Error("Cannot update completed stream");
			}
			content = text;

			if (!streaming) return;

			// Debounce first message
			if (!hasStarted && content.length < minInitialChars) {
				return;
			}

			// Throttle updates
			const now = Date.now();
			if (flushTimer) clearTimeout(flushTimer);

			if (now - lastFlushTime >= throttleMs) {
				this.flush();
			} else {
				flushTimer = setTimeout(() => this.flush(), throttleMs - (now - lastFlushTime));
			}
		},

		async flush(): Promise<void> {
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}

			// Truncate if needed
			let text = content;
			if (text.length > maxLength) {
				text = text.slice(0, maxLength - 3) + "...";
			}

			if (!hasStarted) {
				await sendInitial(text);
				hasStarted = true;
			} else {
				await updateMessage(text);
			}

			lastFlushTime = Date.now();
		},

		async finalize(): Promise<void> {
			if (isComplete) return;
			isComplete = true;

			await this.flush();

			// For draft mode: convert to real message
			if (draftId && !fallbackToMessage) {
				const finalExtra = { ...extra };
				if (messageThreadId) finalExtra.message_thread_id = messageThreadId;
				await api.sendMessage(chatId, content, finalExtra);
				// Clear draft
				if (api.sendMessageDraft) {
					await api.sendMessageDraft(chatId, draftId, "", extra);
				}
			}
		},

		async abort(deleteMessage = false): Promise<void> {
			isComplete = true;
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}

			if (deleteMessage && messageId && api.deleteMessage) {
				await api.deleteMessage(chatId, messageId).catch(() => {});
			}

			if (draftId && api.sendMessageDraft) {
				// Clear draft
				await api.sendMessageDraft(chatId, draftId, "", extra).catch(() => {});
			}
		},

		getContent(): string {
			return content;
		},

		isActive(): boolean {
			return !isComplete;
		},
	};
}

// Draft ID generator (shared across instances for uniqueness)
let draftIdCounter = 0;
function generateDraftId(): number {
	return ++draftIdCounter;
}
