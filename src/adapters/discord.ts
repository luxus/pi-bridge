import { Client, GatewayIntentBits, Events, TextChannel, DMChannel, ThreadChannel, ChatInputCommandInteraction } from "discord.js";
import type {
	ChannelAdapter,
	ChannelMessage,
	AdapterConfig,
	OnIncomingMessage,
	StreamHandle,
} from "../types.ts";
import type { AdapterFactoryContext } from "../registry.ts";
import { getChannelSetting } from "../config.ts";
import { createStream } from "../streaming/draft-stream.ts";

const MAX_LENGTH = 2000;

export async function createDiscordAdapter(config: AdapterConfig, context: AdapterFactoryContext): Promise<ChannelAdapter> {
	const { cwd, log } = context;
	const botToken = (cwd ? getChannelSetting(cwd, "discord.botToken") as string : null)
		?? config.botToken as string;

	const allowedChannelIds = config.allowedChannelIds as string[] | undefined;
	const respondToMentionsOnly = config.respondToMentionsOnly === true;
	const slashCommand = ((config.slashCommand as string) ?? "/ask").replace(/^\//, "");

	if (!botToken) {
		throw new Error("Discord adapter requires botToken in settings under pi-bridge.discord.botToken");
	}

	let client: Client | null = null;
	let botUserId: string | null = null;

	function isAllowed(channelId: string): boolean {
		if (!allowedChannelIds || allowedChannelIds.length === 0) return true;
		return allowedChannelIds.includes(channelId);
	}

	function stripBotMention(text: string): string {
		if (!botUserId) return text;
		return text.replace(new RegExp(`<@!?${botUserId}>\\s*`, "g"), "").trim();
	}

	function isBotMentioned(text: string): boolean {
		if (!botUserId) return false;
		return new RegExp(`<@!?${botUserId}>`).test(text);
	}

	function buildMetadata(
		event: { channelId?: string; userId?: string; messageId?: string; guildId?: string | null; channelType?: string },
		extra?: Record<string, unknown>
	): Record<string, unknown> {
		return {
			channelId: event.channelId,
			userId: event.userId,
			messageId: event.messageId,
			guildId: event.guildId,
			channelType: event.channelType,
			...extra,
		};
	}

	async function sendDiscord(channelId: string, text: string): Promise<void> {
		if (!client) throw new Error("Discord client not initialized");
		const channel = await client.channels.fetch(channelId);
		if (!channel) throw new Error(`Channel ${channelId} not found`);
		if (!(channel instanceof TextChannel) && !(channel instanceof DMChannel) && !(channel instanceof ThreadChannel)) {
			throw new Error(`Channel ${channelId} is not a text channel`);
		}
		await channel.send(text);
	}

	function resolveChannelId(recipient: string): string {
		return recipient.includes(":") ? recipient.split(":")[1] : recipient;
	}

	return {
		direction: "bidirectional" as const,

		async sendTyping(recipient: string): Promise<void> {
			if (!client) return;
			try {
				const channel = await client.channels.fetch(resolveChannelId(recipient));
				if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof ThreadChannel)) {
					await channel.sendTyping();
				}
			} catch {}
		},

		async send(message: ChannelMessage): Promise<void> {
			if (!message.text) {
				throw new Error("Discord adapter requires text");
			}
			const prefix = message.source ? `**[${message.source}]**\n` : "";
			const full = prefix + message.text;

			let channelId = message.recipient;
			if (channelId.includes(":")) {
				channelId = channelId.split(":")[1];
			}

			if (full.length <= MAX_LENGTH) {
				await sendDiscord(channelId, full);
				return;
			}

			let remaining = full;
			while (remaining.length > 0) {
				if (remaining.length <= MAX_LENGTH) {
					await sendDiscord(channelId, remaining);
					break;
				}
				let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
				if (splitAt < MAX_LENGTH / 2) splitAt = MAX_LENGTH;
				await sendDiscord(channelId, remaining.slice(0, splitAt));
				remaining = remaining.slice(splitAt).replace(/^\n/, "");
			}
		},

		createStream(recipient: string, streamConfig?: { throttleMs?: number; minChars?: number }): StreamHandle {
			const resolvedId = resolveChannelId(recipient);
			let messageId: string | null = null;
			let channel: TextChannel | DMChannel | ThreadChannel | null = null;

			const sendFn = async (text: string, isFinal: boolean): Promise<void> => {
				if (!client) throw new Error("Discord client not initialized");

				if (!channel) {
					const fetched = await client.channels.fetch(resolvedId);
					if (!fetched) throw new Error(`Channel ${resolvedId} not found`);
					if (!(fetched instanceof TextChannel) && !(fetched instanceof DMChannel) && !(fetched instanceof ThreadChannel)) {
						throw new Error(`Channel ${resolvedId} is not a text channel`);
					}
					channel = fetched;
				}

				if (!messageId) {
					const msg = await channel.send(text);
					messageId = msg.id;
				} else {
					const msg = await channel.messages.fetch(messageId);
					await msg.edit(text);
				}
			};

			const stream = createStream({
				streaming: true,
				throttleMs: streamConfig?.throttleMs ?? 500,
				minInitialChars: streamConfig?.minChars ?? 30,
				maxLength: MAX_LENGTH,
				sendFn,
			});

			return {
				update: (text: string) => stream.update(text),
				flush: () => stream.flush(),
				finalize: () => stream.finalize(),
				getContent: () => stream.getContent(),
				isActive: () => stream.isActive(),
				abort: async (deleteMessage = false): Promise<void> => {
					if (deleteMessage && messageId && channel) {
						try {
							const msg = await channel.messages.fetch(messageId);
							await msg.delete();
						} catch {}
					}
					await stream.abort();
				},
			};
		},

		async start(onMessage: OnIncomingMessage): Promise<void> {
			if (client) return;

			client = new Client({
				intents: [
					GatewayIntentBits.Guilds,
					GatewayIntentBits.GuildMessages,
					GatewayIntentBits.DirectMessages,
					GatewayIntentBits.MessageContent,
				],
			});

			client.once(Events.ClientReady, () => {
				botUserId = client?.user?.id ?? null;
				log?.("discord-ready", { user: client?.user?.tag, id: botUserId });
			});

			client.on(Events.MessageCreate, async (message) => {
				try {
					if (message.author.bot) return;
					if (!isAllowed(message.channel.id)) return;

					const isDM = message.channel instanceof DMChannel;
					const isMentioned = isBotMentioned(message.content);

					if (respondToMentionsOnly && !isDM && !isMentioned) return;

					const text = stripBotMention(message.content);
					if (!text) return;

					const threadId = message.channel instanceof ThreadChannel ? message.channel.id : undefined;
					const sender = threadId
						? `${(message.channel as ThreadChannel).parentId}:${threadId}`
						: message.channel.id;

					onMessage({
						adapter: "discord",
						sender,
						text,
						metadata: buildMetadata(
							{
								channelId: message.channel.id,
								userId: message.author.id,
								messageId: message.id,
								guildId: message.guild?.id ?? null,
								channelType: isDM ? "dm" : message.channel instanceof ThreadChannel ? "thread" : "text",
							},
							{
								username: message.author.username,
								displayName: message.author.displayName,
								eventType: "message",
							}
						),
					});
				} catch (err) {
					log?.("discord-handler-error", { handler: "messageCreate", error: String(err) }, "ERROR");
				}
			});

			client.on(Events.InteractionCreate, async (interaction) => {
				try {
					if (!interaction.isChatInputCommand()) return;

					const cmdInteraction = interaction as ChatInputCommandInteraction;
					if (cmdInteraction.commandName !== slashCommand) return;

					if (!isAllowed(cmdInteraction.channelId)) {
						await cmdInteraction.reply({ content: "⛔ This command is not available in this channel.", ephemeral: true });
						return;
					}

					const text = cmdInteraction.options.getString("message") ?? "";
					if (!text.trim()) {
						await cmdInteraction.reply({ content: "Please provide a message.", ephemeral: true });
						return;
					}

					await cmdInteraction.deferReply();

					const isDM = cmdInteraction.channel instanceof DMChannel;
					onMessage({
						adapter: "discord",
						sender: cmdInteraction.channelId,
						text: text.trim(),
						metadata: buildMetadata(
							{
								channelId: cmdInteraction.channelId,
								userId: cmdInteraction.user.id,
								messageId: cmdInteraction.id,
								guildId: cmdInteraction.guild?.id ?? null,
								channelType: isDM ? "dm" : cmdInteraction.channel instanceof ThreadChannel ? "thread" : "text",
							},
							{
								username: cmdInteraction.user.username,
								displayName: cmdInteraction.user.displayName,
								eventType: "slash_command",
								command: cmdInteraction.commandName,
							}
						),
					});
				} catch (err) {
					log?.("discord-handler-error", { handler: "interactionCreate", error: String(err) }, "ERROR");
				}
			});

			await client.login(botToken);
		},

		async stop(): Promise<void> {
			if (client) {
				await client.destroy();
				client = null;
			}
		},
	};
}
