/**
 * pi-bridge — Chat history persistence.
 *
 * Stores chat messages per person as Markdown files in a configurable vault.
 *
 * Config (settings.json under "pi-bridge"):
 *   "chatHistory": {
 *     "vaultPath": "/path/to/vault",
 *     "historyDir": "Chat_History",
 *     "persons": {
 *       "14939216": "Yvonne Mauss",
 *       "987654321": "John Doe"
 *     },
 *     "maxContextMessages": 10
 *   }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, IncomingAttachment } from "./types.ts";
import { getChannelSetting } from "./config.ts";

export interface ChatMessage {
	timestamp: string;
	role: "user" | "assistant";
	content: string;
	attachments?: Array<{
		filename: string;
		path: string;
		type: string;
	}>;
}

export interface ChatSession {
	person: string;
	senderId: string;
	adapter: string;
	messages: ChatMessage[];
}

interface ChatHistoryConfig {
	vaultPath: string;
	historyDir: string;
	persons: Record<string, string>;
	maxContextMessages: number;
}

let cachedConfig: ChatHistoryConfig | null = null;
let configCwd: string | null = null;

function getConfig(cwd?: string): ChatHistoryConfig {
	const resolvedCwd = cwd || configCwd || process.cwd();

	if (cachedConfig && configCwd === resolvedCwd) return cachedConfig;

	const vaultPath = getChannelSetting(resolvedCwd, "chatHistory.vaultPath") as string | undefined;
	const historyDir = (getChannelSetting(resolvedCwd, "chatHistory.historyDir") as string) || "Chat_History";
	const persons = (getChannelSetting(resolvedCwd, "chatHistory.persons") as Record<string, string>) || {};
	const maxContextMessages = (getChannelSetting(resolvedCwd, "chatHistory.maxContextMessages") as number) || 10;

	cachedConfig = { vaultPath: vaultPath || "", historyDir, persons, maxContextMessages };
	configCwd = resolvedCwd;
	return cachedConfig;
}

/**
 * Set the working directory used for config resolution.
 * Called once at startup from index.ts.
 */
export function initChatHistory(cwd: string): void {
	configCwd = cwd;
	cachedConfig = null;
}

function getHistoryDir(): string | null {
	const config = getConfig();
	if (!config.vaultPath) return null;
	return path.join(config.vaultPath, config.historyDir);
}

function getPersonName(senderId: string): string {
	const config = getConfig();
	return config.persons[senderId] || `Unknown_${senderId}`;
}

function getFilePath(senderId: string, adapter: string): string | null {
	const dir = getHistoryDir();
	if (!dir) return null;
	const personName = getPersonName(senderId);
	const adapterPrefix = adapter.charAt(0).toUpperCase() + adapter.slice(1);
	return path.join(dir, `${adapterPrefix}_${personName}.md`);
}

export function saveIncomingMessage(message: IncomingMessage): void {
	const filePath = getFilePath(message.sender, message.adapter);
	if (!filePath) return;

	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const personName = getPersonName(message.sender);
	let session: ChatSession;
	if (fs.existsSync(filePath)) {
		session = parseChatFile(fs.readFileSync(filePath, "utf-8"), personName, message.sender, message.adapter);
	} else {
		session = {
			person: personName,
			senderId: message.sender,
			adapter: message.adapter,
			messages: [],
		};
	}

	const attachments = message.attachments?.map((att: IncomingAttachment) => ({
		filename: att.filename || (att.path ? path.basename(att.path) : "unknown"),
		path: att.path || att.url || "",
		type: att.type,
	}));

	session.messages.push({
		timestamp: new Date().toISOString(),
		role: "user",
		content: message.text || "",
		attachments: attachments?.length ? attachments : undefined,
	});

	fs.writeFileSync(filePath, serializeChatFile(session));
}

export function saveAssistantResponse(senderId: string, response: string, adapter = "telegram"): void {
	const filePath = getFilePath(senderId, adapter);
	if (!filePath || !fs.existsSync(filePath)) return;

	const personName = getPersonName(senderId);
	const content = fs.readFileSync(filePath, "utf-8");
	const session = parseChatFile(content, personName, senderId, adapter);

	session.messages.push({
		timestamp: new Date().toISOString(),
		role: "assistant",
		content: response,
	});

	fs.writeFileSync(filePath, serializeChatFile(session));
}

export function getRecentContext(senderId: string, count?: number, adapter = "telegram"): ChatMessage[] {
	const config = getConfig();
	const maxMessages = count ?? config.maxContextMessages;

	const filePath = getFilePath(senderId, adapter);
	if (!filePath || !fs.existsSync(filePath)) return [];

	const personName = getPersonName(senderId);
	const content = fs.readFileSync(filePath, "utf-8");
	const session = parseChatFile(content, personName, senderId, adapter);

	return session.messages.slice(-maxMessages);
}

export function formatContextForPrompt(messages: ChatMessage[]): string {
	if (messages.length === 0) return "";

	const config = getConfig();
	const lines = ["\n--- Previous chat history ---\n"];

	for (const msg of messages) {
		const time = new Date(msg.timestamp).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
		});

		if (msg.role === "user") {
			const senderLabel = Object.values(config.persons)[0] || "User";
			lines.push(`[${time}] ${senderLabel}: ${msg.content}`);
			if (msg.attachments) {
				for (const att of msg.attachments) {
					lines.push(`  📎 ${att.filename} (${att.type})`);
				}
			}
		} else {
			const shortContent = msg.content.slice(0, 200) + (msg.content.length > 200 ? "..." : "");
			lines.push(`[${time}] Assistant: ${shortContent}`);
		}
	}

	lines.push("\n--- End chat history ---\n");
	return lines.join("\n");
}

function parseChatFile(content: string, person: string, senderId: string, adapter: string): ChatSession {
	const session: ChatSession = {
		person,
		senderId,
		adapter,
		messages: [],
	};

	const lines = content.split("\n");
	let inFrontmatter = false;
	let currentMessage: Partial<ChatMessage> | null = null;

	for (const line of lines) {
		if (line === "---") {
			inFrontmatter = !inFrontmatter;
			continue;
		}

		if (inFrontmatter) continue;

		const match = line.match(/^### (\d{2}:\d{2}:\d{2}) - (.+)\s*$/);
		if (match) {
			if (currentMessage?.content) {
				session.messages.push(currentMessage as ChatMessage);
			}
			currentMessage = {
				timestamp: new Date().toISOString(),
				role: match[2].includes("Assistant") ? "assistant" : "user",
				content: "",
			};
			continue;
		}

		if (line.startsWith("> ") && currentMessage) {
			currentMessage.content = line.slice(2);
		}
	}

	if (currentMessage?.content) {
		session.messages.push(currentMessage as ChatMessage);
	}

	return session;
}

function serializeChatFile(session: ChatSession): string {
	const lines: string[] = [];

	lines.push("---");
	lines.push(`person: "${session.person}"`);
	lines.push(`sender_id: "${session.senderId}"`);
	lines.push(`adapter: "${session.adapter}"`);
	lines.push(`message_count: ${session.messages.length}`);
	lines.push(`last_update: "${new Date().toISOString()}"`);
	lines.push("---");
	lines.push("");

	const byDate = new Map<string, ChatMessage[]>();
	for (const msg of session.messages) {
		const date = msg.timestamp.split("T")[0];
		if (!byDate.has(date)) byDate.set(date, []);
		byDate.get(date)!.push(msg);
	}

	for (const [date, msgs] of byDate) {
		lines.push(`## ${date}`);
		lines.push("");

		for (const msg of msgs) {
			const time = new Date(msg.timestamp).toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});

			const sender = msg.role === "user" ? session.person : `${session.person}'s Assistant`;
			lines.push(`### ${time} - ${sender}`);

			if (msg.content) {
				lines.push(`> ${msg.content}`);
			}

			if (msg.attachments) {
				for (const att of msg.attachments) {
					lines.push(`📎 [${att.filename}](attachments/${att.filename.replace(/\s+/g, "_")})`);
				}
			}

			lines.push("");
		}
	}

	return lines.join("\n");
}
