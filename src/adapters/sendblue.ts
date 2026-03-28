/**
 * pi-bridge — SendBlue adapter (bidirectional).
 *
 * Outgoing: SendBlue API v2 send-message.
 * Incoming: Webhook handler mounted on pi-webserver.
 *
 * Supports:
 *   - Text messages (SMS, MMS, iMessage, RCS)
 *   - Group messaging
 *   - Reactions (tapbacks on iMessage)
 *   - Typing indicators
 *   - Read receipts
 *   - Media attachments (images, video)
 *   - Contact management
 *
 * Config (in settings.json under pi-bridge.adapters.sendblue):
 * {
 *   "type": "sendblue",
 *   "apiKeyId": "your-api-key-id",
 *   "apiSecret": "your-api-secret",
 *   "sendblueNumber": "+1234567890",
 *   "webhookPath": "/webhook/sendblue",
 *   "typingIndicators": true,
 *   "readReceipts": true
 * }
 */

import type {
	ChannelAdapter,
	ChannelMessage,
	AdapterConfig,
	OnIncomingMessage,
	IncomingMessage,
	IncomingAttachment,
} from "../types.ts";
import type { AdapterFactoryContext } from "../registry.ts";

const SENDBLUE_API_BASE = "https://api.sendblue.co";

/** SendBlue message status */
type SendBlueStatus =
	| "QUEUED"
	| "PENDING"
	| "SENT"
	| "DELIVERED"
	| "ERROR"
	| "DECLINED"
	| "RECEIVED"
	| "ACCEPTED"
	| "REGISTERED";

/** Service type */
type ServiceType = "iMessage" | "SMS" | "RCS";

/** SendBlue message response */
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

/** SendBlue incoming webhook payload */
export interface SendBlueWebhookPayload {
	accountEmail: string;
	content: string;
	is_outbound: boolean;
	status: SendBlueStatus;
	from_number: string;
	number: string;
	to_number: string;
	service: ServiceType;
	message_handle: string;
	date_sent: string;
	media_url?: string;
	group_id?: string;
	reaction?: string;
}

export async function createSendBlueAdapter(
	config: AdapterConfig,
	context: AdapterFactoryContext
): Promise<ChannelAdapter> {
	const apiKeyId = config.apiKeyId as string;
	const apiSecret = config.apiSecret as string;
	const sendblueNumber = config.sendblueNumber as string;
	const webhookPath = (config.webhookPath as string) || "/webhook/sendblue";
	const enableTyping = config.typingIndicators === true;
	const enableReadReceipts = config.readReceipts === true;

	if (!apiKeyId || !apiSecret) {
		throw new Error("SendBlue adapter requires apiKeyId and apiSecret");
	}

	// Resolve env: prefixed values
	const resolvedApiKeyId = resolveEnvVar(apiKeyId);
	const resolvedApiSecret = resolveEnvVar(apiSecret);

	if (!resolvedApiKeyId || !resolvedApiSecret) {
		throw new Error("SendBlue credentials resolved to empty values");
	}

	let running = false;
	let onMessageCallback: OnIncomingMessage | null = null;

	// ── SendBlue API helpers ────────────────────────────────

	async function sendMessage(
		toNumber: string,
		content: string,
		options: {
			mediaUrl?: string;
			groupId?: string;
			statusCallback?: string;
		} = {}
	): Promise<SendBlueMessageResponse> {
		const body: Record<string, unknown> = {
			number: toNumber,
			content,
			...(sendblueNumber && { from_number: sendblueNumber }),
			...(options.groupId && { group_id: options.groupId }),
			...(options.mediaUrl && { media_url: options.mediaUrl }),
			...(options.statusCallback && { status_callback: options.statusCallback }),
		};

		const res = await fetch(`${SENDBLUE_API_BASE}/api/send-message`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"sb-api-key-id": resolvedApiKeyId,
				"sb-api-secret-key": resolvedApiSecret,
			},
			body: JSON.stringify(body),
		});

		const data = await res.json() as SendBlueMessageResponse;
		if (!res.ok || data.status === "ERROR") {
			throw new Error(`SendBlue API error ${res.status}: ${data.message || data.error_code || "unknown"}`);
		}
		return data;
	}

	async function sendTypingIndicator(toNumber: string): Promise<void> {
		if (!enableTyping) return;
		try {
			await fetch(`${SENDBLUE_API_BASE}/api/send-typing-indicator`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"sb-api-key-id": resolvedApiKeyId,
					"sb-api-secret-key": resolvedApiSecret,
				},
				body: JSON.stringify({
					number: toNumber,
					...(sendblueNumber && { from_number: sendblueNumber }),
				}),
			});
		} catch {
			// Best-effort
		}
	}

	async function sendReadReceipt(messageHandle: string): Promise<void> {
		if (!enableReadReceipts) return;
		try {
			await fetch(`${SENDBLUE_API_BASE}/api/mark-read`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"sb-api-key-id": resolvedApiKeyId,
					"sb-api-secret-key": resolvedApiSecret,
				},
				body: JSON.stringify({ message_handle: messageHandle }),
			});
		} catch {
			// Best-effort
		}
	}

	async function sendReaction(
		toNumber: string,
		messageHandle: string,
		reaction: string
	): Promise<void> {
		try {
			await fetch(`${SENDBLUE_API_BASE}/api/send-reaction`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"sb-api-key-id": resolvedApiKeyId,
					"sb-api-secret-key": resolvedApiSecret,
				},
				body: JSON.stringify({
					number: toNumber,
					message_handle: messageHandle,
					reaction,
					...(sendblueNumber && { from_number: sendblueNumber }),
				}),
			});
		} catch {
			// Best-effort
		}
	}

	// ── Webhook handler ─────────────────────────────────────

	function handleWebhook(payload: SendBlueWebhookPayload): void {
		// Only process incoming messages
		if (payload.is_outbound) return;

		const incoming: IncomingMessage = {
			adapter: "sendblue",
			sender: payload.from_number,
			text: payload.content,
			metadata: {
				messageHandle: payload.message_handle,
				service: payload.service,
				status: payload.status,
				dateSent: payload.date_sent,
				toNumber: payload.to_number,
				accountEmail: payload.accountEmail,
				...(payload.group_id && { groupId: payload.group_id }),
				...(payload.reaction && { reaction: payload.reaction }),
			},
		};

		// Handle media attachment
		if (payload.media_url) {
			incoming.attachments = [{
				type: "image", // Could be image or video
				url: payload.media_url,
				filename: "media",
				mimeType: "application/octet-stream", // Will be determined when fetched
			}];
		}

		// Auto-send read receipt
		if (enableReadReceipts && payload.message_handle) {
			sendReadReceipt(payload.message_handle).catch(() => {});
		}

		onMessageCallback?.(incoming);
	}

	// ── Adapter ─────────────────────────────────────────────

	return {
		direction: "bidirectional" as const,

		async sendTyping(recipient: string): Promise<void> {
			await sendTypingIndicator(recipient);
		},

		async send(message: ChannelMessage): Promise<void> {
			if (!message.text) {
				throw new Error("SendBlue adapter requires text");
			}
			await sendMessage(message.recipient, message.text);
		},

		async start(onMessage: OnIncomingMessage): Promise<void> {
			if (running) return;
			running = true;
			onMessageCallback = onMessage;

			// Register webhook handler with pi-webserver if available
			// This is done via event bus - the webserver extension will pick it up
			context.events.emit("web:mount-api", {
				prefix: webhookPath,
				handler: (req: any, res: any) => {
					if (req.method !== "POST") {
						res.status(405).json({ error: "Method not allowed" });
						return;
					}
					try {
						const payload = req.body as SendBlueWebhookPayload;
						handleWebhook(payload);
						res.status(200).json({ received: true });
					} catch (err: any) {
						res.status(400).json({ error: err.message });
					}
				},
			});
		},

		async stop(): Promise<void> {
			running = false;
			onMessageCallback = null;
		},

		// Additional capabilities exposed for advanced use
		capabilities: {
			sendReaction,
			sendTypingIndicator,
			sendReadReceipt,
		},
	};
}

/** Resolve environment variable references like "env:VAR_NAME" */
function resolveEnvVar(value: string | undefined): string | undefined {
	if (!value) return value;
	if (value.startsWith("env:")) {
		const varName = value.slice(4);
		return process.env[varName];
	}
	return value;
}
