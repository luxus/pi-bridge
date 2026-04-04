/**
 * pi-bridge — SendBlue adapter (bidirectional, CLI-based).
 *
 * Uses @sendblue/cli credentials (~/.sendblue/credentials.json) for authentication.
 * Outgoing: Direct API calls (matching CLI's sendMessage function).
 * Incoming: Polling via Messages API (matching CLI's getMessages function).
 *
 * Supports:
 *   - Text messages (SMS, MMS, iMessage, RCS)
 *   - Group messaging
 *   - Reactions (tapbacks on iMessage)
 *   - Typing indicators
 *   - Read receipts
 *   - Media attachments (images, video)
 *   - Send styles (iMessage effects)
 *   - Message splitting for long content (>18996 chars)
 *   - Deduplication via message_handle
 *
 * Config (in settings.json under pi-bridge.adapters.sendblue):
 * {
 *   "type": "sendblue",
 *   "pollingIntervalMs": 10000,
 *   "typingIndicators": true,
 *   "readReceipts": true,
 *   "sendStyle": ""
 * }
 *
 * Credentials are loaded automatically from ~/.sendblue/credentials.json
 * (created by `sendblue login`). Config values override CLI credentials.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
	ChannelAdapter,
	ChannelMessage,
	AdapterConfig,
	OnIncomingMessage,
	IncomingMessage,
	IncomingAttachment,
	TranscriptionConfig,
	TTSConfig,
} from "../types.ts";
import type { AdapterFactoryContext } from "../registry.ts";
import { createTranscriptionProvider, type TranscriptionProvider } from "./transcription.ts";
import { createTTSProvider, type TTSProvider } from "./tts.ts";

const SENDBLUE_API_BASE = "https://api.sendblue.com";
const MAX_MESSAGE_LENGTH = 18996;
const DEFAULT_POLLING_INTERVAL_MS = 10000;
const DEDUP_CACHE_SIZE = 500;

// ── File size limits ──────────────────────────────────────────────

const MAX_FILE_SIZE = 1_048_576; // 1MB for photos/text docs
const MAX_AUDIO_SIZE = 10_485_760; // 10MB for audio
const MAX_DOCUMENT_SIZE = 20_971_520; // 20MB for PDF/Office

// ── MIME type detection ─────────────────────────────────────────

/** MIME types we treat as text documents. */
const TEXT_MIME_TYPES = new Set([
	"text/plain",
	"text/markdown",
	"text/csv",
	"text/html",
	"text/xml",
	"text/css",
	"text/javascript",
	"application/json",
	"application/xml",
	"application/javascript",
	"application/typescript",
	"application/x-yaml",
	"application/x-toml",
	"application/x-sh",
]);

/** File extensions we treat as text even if MIME is generic. */
const TEXT_EXTENSIONS = new Set([
	".md", ".markdown", ".txt", ".csv", ".json", ".jsonl", ".yaml", ".yml",
	".toml", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".tsx", ".jsx",
	".py", ".rs", ".go", ".rb", ".php", ".java", ".kt", ".c", ".cpp", ".h",
	".sh", ".bash", ".zsh", ".fish", ".sql", ".graphql", ".gql",
	".env", ".ini", ".cfg", ".conf", ".properties", ".log",
	".gitignore", ".dockerignore", ".editorconfig",
]);

/** MIME types for documents requiring conversion (PDF, Office). */
const DOCUMENT_MIME_TYPES = new Set([
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // XLSX
	"application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
	"application/msword", // DOC (legacy)
	"application/vnd.ms-excel", // XLS (legacy)
	"application/vnd.ms-powerpoint", // PPT (legacy)
	"application/vnd.oasis.opendocument.text", // ODT
	"application/vnd.oasis.opendocument.spreadsheet", // ODS
	"application/vnd.oasis.opendocument.presentation", // ODP
	"application/rtf",
	"text/rtf",
]);

/** File extensions for documents requiring conversion. */
const DOCUMENT_EXTENSIONS = new Set([
	".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
	".odt", ".ods", ".odp", ".rtf",
]);

/** Audio MIME types that can be transcribed. */
const AUDIO_MIME_TYPES = new Set([
	"audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm",
	"audio/x-m4a", "audio/flac", "audio/aac", "audio/mp3",
	"video/ogg", // .ogg containers can be audio-only
]);

function isImageMime(mime: string | undefined): boolean {
	if (!mime) return false;
	return mime.startsWith("image/");
}

function isAudioMime(mime: string | undefined): boolean {
	if (!mime) return false;
	if (AUDIO_MIME_TYPES.has(mime)) return true;
	return mime.startsWith("audio/");
}

function isTextDocument(mimeType: string | undefined, filename: string | undefined): boolean {
	if (mimeType && TEXT_MIME_TYPES.has(mimeType)) return true;
	if (filename) {
		const ext = path.extname(filename).toLowerCase();
		if (TEXT_EXTENSIONS.has(ext)) return true;
	}
	return false;
}

function isDocumentFile(mimeType: string | undefined, filename: string | undefined): boolean {
	if (mimeType && DOCUMENT_MIME_TYPES.has(mimeType)) return true;
	if (filename) {
		const ext = path.extname(filename).toLowerCase();
		if (DOCUMENT_EXTENSIONS.has(ext)) return true;
	}
	return false;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / 1_048_576).toFixed(1)}MB`;
}

// ── CLI credentials ─────────────────────────────────────────────

interface SendblueCliCredentials {
	apiKey: string;
	apiSecret: string;
	email: string;
	assignedNumber: string;
	plan: string;
	createdAt: string;
}

function loadCliCredentials(): SendblueCliCredentials | null {
	try {
		const credPath = path.join(os.homedir(), ".sendblue", "credentials.json");
		const data = fs.readFileSync(credPath, "utf-8");
		return JSON.parse(data) as SendblueCliCredentials;
	} catch {
		return null;
	}
}

// ── API types ───────────────────────────────────────────────────

type SendBlueStatus =
	| "QUEUED" | "PENDING" | "SENT" | "DELIVERED"
	| "ERROR" | "DECLINED" | "RECEIVED" | "ACCEPTED" | "REGISTERED";

type ServiceType = "iMessage" | "SMS" | "RCS";

interface SendBlueMessageResponse {
	status: "OK" | "ERROR";
	message?: string;
	data?: {
		message_handle?: string;
		status?: SendBlueStatus;
		service?: ServiceType;
		date_sent?: string;
	};
	error_code?: string;
}

interface SendBlueApiMessage {
	content: string;
	number: string;
	from_number: string;
	to_number: string;
	is_outbound: boolean;
	status: SendBlueStatus;
	date_sent: string;
	date_updated: string;
	sendblue_number: string;
	media_url?: string;
	message_handle: string;
	row_id: string;
	service?: ServiceType;
	group_id?: string;
	participants?: string[];
	group_display_name?: string;
	was_downgraded?: boolean;
	opted_out?: boolean;
	[key: string]: unknown;
}

interface MessagesApiResponse {
	status: string;
	data: SendBlueApiMessage[];
	pagination: {
		total: number;
		limit: number;
		offset: number;
		hasMore: boolean;
	};
}

// ── Adapter factory ─────────────────────────────────────────────

export async function createSendBlueAdapter(
	config: AdapterConfig,
	context: AdapterFactoryContext
): Promise<ChannelAdapter> {
	const log = context.log ?? ((): void => { });

	// ── Credential resolution: config > CLI credentials ─────────

	const cliCreds = loadCliCredentials();

	const apiKeyId = (config.apiKeyId as string | undefined)
		?? cliCreds?.apiKey
		?? process.env.SENDBLUE_API_KEY_ID;

	const apiSecret = (config.apiSecret as string | undefined)
		?? cliCreds?.apiSecret
		?? process.env.SENDBLUE_API_SECRET;

	let fromNumber = (config.sendblueNumber as string | undefined)
		?? cliCreds?.assignedNumber
		?? process.env.SENDBLUE_NUMBER;

	// Resolve env:VAR_NAME syntax
	const resolvedKeyId = resolveEnv(apiKeyId);
	const resolvedSecret = resolveEnv(apiSecret);
	const resolvedFromNumber = resolveEnv(fromNumber);

	if (!resolvedKeyId || !resolvedSecret) {
		throw new Error(
			"SendBlue adapter: no credentials found. " +
			"Run `sendblue login` or set apiKeyId/apiSecret in config."
		);
	}

	if (!resolvedFromNumber) {
		throw new Error(
			"SendBlue adapter: no from_number (sendblueNumber) found. " +
			"Run `sendblue login` or set sendblueNumber in config."
		);
	}

	const enableTyping = config.typingIndicators === true;
	const enableReadReceipts = config.readReceipts === true;
	const sendStyle = config.sendStyle as string | undefined;
	const pollingInterval = (config.pollingIntervalMs as number) || DEFAULT_POLLING_INTERVAL_MS;

	// ── Transcription setup ─────────────────────────────────────────
	const transcriptionConfig = config.transcription as TranscriptionConfig | undefined;
	let transcriber: TranscriptionProvider | null = null;
	let transcriberError: string | null = null;
	if (transcriptionConfig?.enabled) {
		try {
			transcriber = await createTranscriptionProvider(transcriptionConfig, context.modelRegistry);
		} catch (err: any) {
			transcriberError = err.message ?? "Unknown transcription config error";
			log("sendblue.transcription_error", { error: transcriberError }, "warning");
		}
	}

	// ── TTS setup ───────────────────────────────────────────────────
	const ttsConfig = config.tts as TTSConfig | undefined;
	let ttsProvider: TTSProvider | null = null;
	let ttsError: string | null = null;
	if (ttsConfig?.enabled) {
		try {
			ttsProvider = await createTTSProvider(ttsConfig, context.modelRegistry);
		} catch (err: any) {
			ttsError = err.message ?? "Unknown TTS config error";
			log("sendblue.tts_error", { error: ttsError }, "warning");
		}
	}

	// ── State ───────────────────────────────────────────────────────

	let running = false;
	let onMessage: OnIncomingMessage | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	const seenHandles = new Set<string>();
	const handleOrder: string[] = [];

	// Track temp files for cleanup
	const tempFiles: string[] = [];

	// ── Temp file helpers ───────────────────────────────────────────

	function createTempPath(ext: string): string {
		const tmpDir = path.join(os.tmpdir(), "pi-bridge", "sendblue");
		fs.mkdirSync(tmpDir, { recursive: true });
		const timestamp = Date.now();
		const random = Math.random().toString(36).slice(2, 10);
		return path.join(tmpDir, `sendblue-${timestamp}-${random}${ext}`);
	}

	function cleanupTempFiles(): void {
		for (const f of tempFiles) {
			try { fs.unlinkSync(f); } catch { /* ignore */ }
		}
		tempFiles.length = 0;
	}

	// ── Helpers ─────────────────────────────────────────────────

	function dedupAdd(handle: string): boolean {
		if (seenHandles.has(handle)) return false;
		seenHandles.add(handle);
		handleOrder.push(handle);
		// Evict oldest when over limit
		while (handleOrder.length > DEDUP_CACHE_SIZE) {
			seenHandles.delete(handleOrder.shift()!);
		}
		return true;
	}

	function apiHeaders(): Record<string, string> {
		return {
			"Content-Type": "application/json",
			"sb-api-key-id": resolvedKeyId!,
			"sb-api-secret-key": resolvedSecret!,
		};
	}

	async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30_000);
		try {
			const res = await fetch(url, { ...init, signal: controller.signal });
			return res;
		} finally {
			clearTimeout(timeout);
		}
	}

	async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
		const res = await apiFetch(url, init);
		const ct = res.headers.get("content-type") || "";
		if (ct.includes("application/json")) {
			return (await res.json()) as T;
		}
		const text = await res.text();
		throw new Error(`SendBlue API ${res.status}: ${text.slice(0, 200)}`);
	}

	// ── Media download ──────────────────────────────────────────────

	async function downloadMedia(
		url: string,
		suggestedName?: string,
		maxSize?: number
	): Promise<{ localPath: string; size: number } | null> {
		try {
			const res = await apiFetch(url, { method: "GET" });
			if (!res.ok) {
				log("sendblue.download_error", { url, status: res.status }, "warning");
				return null;
			}

			// Check Content-Length header if maxSize specified
			const contentLength = res.headers.get("content-length");
			if (maxSize && contentLength) {
				const size = parseInt(contentLength, 10);
				if (size > maxSize) {
					log("sendblue.download_too_large", { url, size, maxSize }, "warning");
					return null;
				}
			}

			const buffer = Buffer.from(await res.arrayBuffer());

			// Verify size after download
			if (maxSize && buffer.length > maxSize) {
				log("sendblue.download_too_large", { url, size: buffer.length, maxSize }, "warning");
				return null;
			}

			// Determine extension from URL or suggested name
			let ext = "";
			if (suggestedName) {
				ext = path.extname(suggestedName);
			} else {
				// Try to extract from URL pathname
				try {
					const urlObj = new URL(url);
					ext = path.extname(urlObj.pathname);
				} catch {
					// URL parsing failed, continue without extension
				}
			}

			const localPath = createTempPath(ext || ".bin");
			fs.writeFileSync(localPath, buffer);
			tempFiles.push(localPath);

			return { localPath, size: buffer.length };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log("sendblue.download_failed", { url, error: msg }, "warning");
			return null;
		}
	}

	// ── Media upload ────────────────────────────────────────────────

	async function uploadMedia(filePath: string): Promise<string | null> {
		try {
			const fileBuffer = fs.readFileSync(filePath);
			const filename = path.basename(filePath);

			const form = new FormData();
			form.append("file", new Blob([fileBuffer]), filename);

			const res = await fetch(`${SENDBLUE_API_BASE}/api/upload-file`, {
				method: "POST",
				headers: {
					"sb-api-key-id": resolvedKeyId!,
					"sb-api-secret-key": resolvedSecret!,
				},
				body: form,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => "unknown error");
				log("sendblue.upload_error", { filePath, status: res.status, error: text }, "warning");
				return null;
			}

			const data = await res.json() as { media_url?: string; url?: string };
			const mediaUrl = data.media_url || data.url;
			if (!mediaUrl) {
				log("sendblue.upload_no_url", { filePath, response: data }, "warning");
				return null;
			}

			return mediaUrl;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log("sendblue.upload_failed", { filePath, error: msg }, "warning");
			return null;
		}
	}

	// ── Split long messages ─────────────────────────────────────────

	function splitMessage(content: string): string[] {
		if (content.length <= MAX_MESSAGE_LENGTH) return [content];
		const chunks: string[] = [];
		let remaining = content;
		while (remaining.length > 0) {
			if (remaining.length <= MAX_MESSAGE_LENGTH) {
				chunks.push(remaining);
				break;
			}
			let splitPoint = MAX_MESSAGE_LENGTH;
			while (splitPoint > 0 && remaining[splitPoint] !== " ") splitPoint--;
			if (splitPoint === 0) splitPoint = MAX_MESSAGE_LENGTH;
			chunks.push(remaining.slice(0, splitPoint));
			remaining = remaining.slice(splitPoint).trimStart();
		}
		return chunks;
	}

	// ── Outgoing: send message ──────────────────────────────────

	async function sendMessage(
		toNumber: string,
		content: string,
		options: { mediaUrl?: string; groupId?: string } = {}
	): Promise<SendBlueMessageResponse> {
		const chunks = splitMessage(content);
		let lastResponse: SendBlueMessageResponse | undefined;

		for (let i = 0; i < chunks.length; i++) {
			const isLast = i === chunks.length - 1;
			const body: Record<string, unknown> = {
				number: toNumber,
				content: chunks[i],
				from_number: resolvedFromNumber,
				...(options.groupId && { group_id: options.groupId }),
				...(isLast && options.mediaUrl && { media_url: options.mediaUrl }),
				...(sendStyle && { send_style: sendStyle }),
			};

			const res = await apiJson<SendBlueMessageResponse>(
				`${SENDBLUE_API_BASE}/api/send-message`,
				{ method: "POST", headers: apiHeaders(), body: JSON.stringify(body) }
			);

			if (res.status === "ERROR") {
				throw new Error(`SendBlue API error: ${res.message ?? res.error_code ?? "unknown"}`);
			}
			lastResponse = res;
		}

		return lastResponse ?? { status: "OK" };
	}

	// ── Incoming: poll messages ─────────────────────────────────

	async function pollMessages(): Promise<void> {
		if (!running) return;
		try {
			const params = new URLSearchParams({
				limit: "20",
				order_by: "createdAt",
				order_direction: "desc",
			});

			const res = await apiJson<MessagesApiResponse>(
				`${SENDBLUE_API_BASE}/api/v2/messages?${params}`,
				{ method: "GET", headers: apiHeaders() }
			);

			// Process newest → oldest, but emit oldest → newest for correct ordering
			const inbound = res.data.filter(m => !m.is_outbound && m.status === "RECEIVED").reverse();

			for (const msg of inbound) {
				if (!dedupAdd(msg.message_handle)) continue;

				// Log notable conditions
				if (msg.was_downgraded) {
					log("sendblue.downgraded", {
						from: msg.from_number,
						service: msg.service,
						messageHandle: msg.message_handle,
					}, "warning");
				}
				if (msg.opted_out) {
					log("sendblue.opted_out", {
						from: msg.from_number,
						messageHandle: msg.message_handle,
					}, "warning");
				}

				const metadata: Record<string, unknown> = {
					messageHandle: msg.message_handle,
					service: msg.service,
					status: msg.status,
					dateSent: msg.date_sent,
					dateUpdated: msg.date_updated,
					toNumber: msg.to_number,
					sendblueNumber: msg.sendblue_number,
					wasDowngraded: msg.was_downgraded,
					optedOut: msg.opted_out,
					...(msg.group_id && { groupId: msg.group_id }),
					...(msg.participants && { participants: msg.participants }),
					...(msg.group_display_name && { groupDisplayName: msg.group_display_name }),
				};

				const incoming: IncomingMessage = {
					adapter: "sendblue",
					sender: msg.from_number,
					text: msg.content,
					metadata,
				};

				// ── Media processing ─────────────────────────────────────
				if (msg.media_url) {
					const filename = path.basename(msg.media_url).split("?")[0] || "media";
					const ext = path.extname(filename).toLowerCase();

					// Detect MIME type from extension
					let mimeType = "application/octet-stream";
					if (isImageMime(mimeType) || [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"].includes(ext)) {
						mimeType = ext === ".png" ? "image/png" :
							ext === ".gif" ? "image/gif" :
							ext === ".webp" ? "image/webp" :
							ext === ".bmp" ? "image/bmp" :
							"image/jpeg";
					} else if ([".mp3", ".m4a", ".ogg", ".wav", ".caf", ".aac", ".flac"].includes(ext)) {
						mimeType = ext === ".mp3" ? "audio/mpeg" :
							ext === ".m4a" ? "audio/x-m4a" :
							ext === ".ogg" ? "audio/ogg" :
							ext === ".wav" ? "audio/wav" :
							ext === ".caf" ? "audio/x-caf" :
							ext === ".aac" ? "audio/aac" :
							"audio/flac";
					} else if (isTextDocument(mimeType, filename)) {
						mimeType = "text/plain";
					} else if (isDocumentFile(mimeType, filename)) {
						// Keep as document type
					}

					// Determine max size based on type
					let maxSize = MAX_FILE_SIZE;
					if (isAudioMime(mimeType) || ext === ".caf") {
						maxSize = MAX_AUDIO_SIZE;
					} else if (isDocumentFile(mimeType, filename)) {
						maxSize = MAX_DOCUMENT_SIZE;
					}

					// Download the media
					const downloaded = await downloadMedia(msg.media_url, filename, maxSize);

					if (!downloaded) {
						// Failed to download - include URL as fallback
						incoming.attachments = [{
							type: isImageMime(mimeType) ? "image" : "document",
							url: msg.media_url,
							filename,
							mimeType,
						}];
					} else if (isImageMime(mimeType)) {
						// Image attachment
						incoming.attachments = [{
							type: "image",
							path: downloaded.localPath,
							url: msg.media_url,
							filename,
							mimeType,
							size: downloaded.size,
						}];
					} else if (isAudioMime(mimeType) || ext === ".caf") {
						// Audio/Voice - attempt transcription
						if (!transcriber) {
							// No transcriber available
							incoming.text = transcriberError
								? `⚠️ Voice transcription misconfigured: ${transcriberError}`
								: "⚠️ Voice messages are not supported. Please type your message.";
							// Clean up the temp file since we can't process it
							try { fs.unlinkSync(downloaded.localPath); } catch { /* ignore */ }
						} else {
							const result = await transcriber.transcribe(downloaded.localPath);
							// Clean up temp file after transcription
							try { fs.unlinkSync(downloaded.localPath); } catch { /* ignore */ }

							if (!result.ok || !result.text) {
								incoming.text = `🎤 (voice message — transcription failed${result.error ? ": " + result.error : ""})`;
							} else {
								incoming.text = `🎤 [Voice message]: ${result.text}`;
							}
						}
					} else if (isTextDocument(mimeType, filename) || isDocumentFile(mimeType, filename)) {
						// Document attachment
						incoming.attachments = [{
							type: "document",
							path: downloaded.localPath,
							url: msg.media_url,
							filename,
							mimeType,
							size: downloaded.size,
						}];
					} else {
						// Unknown type - treat as document
						incoming.attachments = [{
							type: "document",
							path: downloaded.localPath,
							url: msg.media_url,
							filename,
							mimeType,
							size: downloaded.size,
						}];
					}
				}

				// Auto read receipt
				if (enableReadReceipts && msg.message_handle) {
					sendReadReceipt(msg.message_handle).catch(() => { });
				}

				onMessage?.(incoming);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log("sendblue.poll_error", { error: msg }, "error");
		}
	}

	// ── Typing indicator ────────────────────────────────────────

	async function sendTypingIndicator(toNumber: string): Promise<void> {
		if (!enableTyping) return;
		try {
			await apiFetch(`${SENDBLUE_API_BASE}/api/send-typing-indicator`, {
				method: "POST",
				headers: apiHeaders(),
				body: JSON.stringify({ number: toNumber, from_number: resolvedFromNumber }),
			});
		} catch (err) {
			log("sendblue.typing_error", { error: String(err), to: toNumber }, "warning");
		}
	}

	// ── Read receipt ────────────────────────────────────────────

	async function sendReadReceipt(messageHandle: string): Promise<void> {
		if (!enableReadReceipts) return;
		try {
			await apiFetch(`${SENDBLUE_API_BASE}/api/mark-read`, {
				method: "POST",
				headers: apiHeaders(),
				body: JSON.stringify({ message_handle: messageHandle }),
			});
		} catch (err) {
			log("sendblue.read_receipt_error", { error: String(err), messageHandle }, "warning");
		}
	}

	// ── Reaction (tapback) ──────────────────────────────────────

	async function sendReaction(
		toNumber: string,
		messageHandle: string,
		reaction: string
	): Promise<void> {
		try {
			await apiFetch(`${SENDBLUE_API_BASE}/api/send-reaction`, {
				method: "POST",
				headers: apiHeaders(),
				body: JSON.stringify({
					number: toNumber,
					message_handle: messageHandle,
					reaction,
					from_number: resolvedFromNumber,
				}),
			});
		} catch (err) {
			log("sendblue.reaction_error", { error: String(err), to: toNumber, messageHandle }, "warning");
		}
	}

	// ── Adapter interface ───────────────────────────────────────

	return {
		direction: "bidirectional",

		async sendTyping(recipient: string): Promise<void> {
			await sendTypingIndicator(recipient);
		},

		async send(message: ChannelMessage): Promise<void> {
			if (!message.text) {
				throw new Error("SendBlue adapter requires text");
			}

			// Check if voice message is requested via metadata
			const voiceRequested = message.metadata?.voice === true;

			if (voiceRequested && ttsProvider) {
				// Generate voice message using TTS
				const result = await ttsProvider.synthesize(message.text);
				if (result.ok && result.audioPath) {
					try {
						// Upload the audio file to get a media URL
						const mediaUrl = await uploadMedia(result.audioPath);
						if (mediaUrl) {
							// Send as voice message with media_url
							await sendMessage(message.recipient, message.text, { mediaUrl });
							return;
						} else {
							log("sendblue.voice_upload_failed", { recipient: message.recipient }, "warning");
							// Fall back to text message
						}
					} finally {
						// Clean up the temporary audio file
						try {
							fs.unlinkSync(result.audioPath);
						} catch {
							/* ignore */
						}
					}
				}
			}

			if (voiceRequested && !ttsProvider) {
				// TTS requested but not available - log warning and fall back to text
				log("sendblue.tts_not_available", { error: ttsError || "TTS not configured" }, "warning");
			}

			// Send as regular text message
			await sendMessage(message.recipient, message.text);
		},

		async start(onMsg: OnIncomingMessage): Promise<void> {
			if (running) return;
			running = true;
			onMessage = onMsg;

			// Initial poll to catch any recent messages
			await pollMessages();

			// Start polling interval
			pollTimer = setInterval(() => {
				if (running) pollMessages();
			}, pollingInterval);

			log("sendblue.started", {
				number: resolvedFromNumber,
				pollingIntervalMs: pollingInterval,
			}, "info");
		},

		async stop(): Promise<void> {
			running = false;
			onMessage = null;
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
			cleanupTempFiles();
			log("sendblue.stopped", {}, "info");
		},
	};
}

/** Resolve "env:VAR_NAME" syntax to process.env value */
function resolveEnv(value: string | undefined): string | undefined {
	if (!value) return value;
	if (value.startsWith("env:")) {
		return process.env[value.slice(4)];
	}
	return value;
}
