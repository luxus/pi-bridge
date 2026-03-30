/**
 * pi-bridge — Pluggable Text-to-Speech (TTS).
 *
 * Supports three providers:
 *   - "apple"      — macOS `say` command (free, offline, no API key)
 *   - "openai"     — OpenAI TTS API (tts-1, tts-1-hd)
 *   - "elevenlabs" — ElevenLabs TTS API
 *
 * Usage:
 *   const provider = createTTSProvider(config);
 *   const result = await provider.synthesize("Hello world");
 *   if (result.ok) {
 *     // result.audioPath contains the audio file
 *   }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { TTSConfig } from "../types.ts";

// ── Public interface ────────────────────────────────────────────

export interface TTSResult {
	ok: boolean;
	/** Path to the generated audio file (only if ok=true) */
	audioPath?: string;
	/** Error message (only if ok=false) */
	error?: string;
}

export interface TTSProvider {
	/**
	 * Synthesize text to speech.
	 * Returns the path to the generated audio file.
	 * The caller is responsible for cleaning up the file.
	 */
	synthesize(text: string): Promise<TTSResult>;
}

/**
 * Create a TTS provider from config.
 * If modelRegistry is provided, OpenAI/ElevenLabs providers will use pi's built-in
 * authentication instead of requiring explicit API keys in config.
 */
export async function createTTSProvider(
	config: TTSConfig,
	modelRegistry?: ModelRegistry,
): Promise<TTSProvider> {
	switch (config.provider) {
		case "apple":
			return new AppleProvider(config);
		case "openai":
			return await OpenAIProvider.create(config, modelRegistry);
		case "elevenlabs":
			return await ElevenLabsProvider.create(config, modelRegistry);
		default:
			throw new Error(`Unknown TTS provider: ${config.provider}`);
	}
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Resolve API key from config value.
 * Priority:
 * 1. If no value provided and modelRegistry available → use pi's built-in auth
 * 2. Plain string → literal value (put secrets directly in settings.json)
 */
async function resolveApiKey(
	value: string | undefined,
	provider: string,
	modelRegistry?: ModelRegistry,
): Promise<string | undefined> {
	// No explicit config → try pi's built-in authentication
	if (!value) {
		if (modelRegistry) {
			const key = await modelRegistry.getApiKeyForProvider(provider);
			if (key) return key;
		}
		return undefined;
	}

	return value;
}

/**
 * Create a temporary file path with the given extension.
 */
function createTempPath(ext: string): string {
	const tmpDir = path.join(os.tmpdir(), "pi-bridge", "tts");
	fs.mkdirSync(tmpDir, { recursive: true });
	const timestamp = Date.now();
	const random = Math.random().toString(36).slice(2, 10);
	return path.join(tmpDir, `tts-${timestamp}-${random}${ext}`);
}

// ── Apple Provider ──────────────────────────────────────────────

/**
 * Apple TTS using the `say` command (macOS only).
 * Outputs to AAC format (.m4a) then converts to OPUS for Telegram.
 */
class AppleProvider implements TTSProvider {
	private voice: string | undefined;
	private speed: number;

	constructor(config: TTSConfig) {
		this.voice = config.voice;
		this.speed = config.speed ?? 1.0;
	}

	async synthesize(text: string): Promise<TTSResult> {
		if (process.platform !== "darwin") {
			return { ok: false, error: "Apple TTS is only available on macOS" };
		}

		if (!text.trim()) {
			return { ok: false, error: "Text cannot be empty" };
		}

		// Generate intermediate AAC file
		const aacPath = createTempPath(".m4a");
		const opusPath = createTempPath(".ogg");

		try {
			// Use `say` command to generate audio
			const args: string[] = [];
			if (this.voice) {
				args.push("-v", this.voice);
			}
			// Speed: say uses words per minute, default ~180
			// Map 0.5-2.0 speed factor to WPM
			if (this.speed !== 1.0) {
				const baseWpm = 180;
				const wpm = Math.round(baseWpm * this.speed);
				args.push("-r", String(wpm));
			}
			args.push("-o", aacPath, text);

			await new Promise<void>((resolve, reject) => {
				execFile("say", args, { timeout: 60_000 }, (err, _stdout, stderr) => {
					if (err) {
						reject(new Error(stderr?.trim() || err.message));
						return;
					}
					resolve();
				});
			});

			// Convert AAC to OPUS for Telegram
			await this.convertToOpus(aacPath, opusPath);

			// Clean up intermediate AAC file
			try {
				fs.unlinkSync(aacPath);
			} catch {
				/* ignore */
			}

			return { ok: true, audioPath: opusPath };
		} catch (err: any) {
			// Clean up on failure
			try {
				fs.unlinkSync(aacPath);
			} catch {
				/* ignore */
			}
			try {
				fs.unlinkSync(opusPath);
			} catch {
				/* ignore */
			}
			return { ok: false, error: `Apple TTS failed: ${err.message}` };
		}
	}

	/**
	 * Convert audio file to OPUS format for Telegram voice messages.
	 */
	private convertToOpus(inputPath: string, outputPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			execFile(
				"ffmpeg",
				[
					"-i",
					inputPath,
					"-c:a",
					"libopus",
					"-b:a",
					"24k", // 24kbps is good for voice
					"-ar",
					"24000", // 24kHz sample rate
					"-y",
					outputPath,
				],
				{ timeout: 30_000 },
				(err, _stdout, stderr) => {
					if (err) {
						reject(new Error(`ffmpeg conversion failed: ${stderr?.trim() || err.message}`));
						return;
					}
					resolve();
				},
			);
		});
	}
}

// ── OpenAI Provider ─────────────────────────────────────────────

/**
 * OpenAI TTS API provider.
 * Supports tts-1 and tts-1-hd models.
 * Outputs MP3 by default, converts to OPUS for Telegram.
 */
class OpenAIProvider implements TTSProvider {
	private apiKey: string;
	private model: string;
	private voice: string;
	private speed: number;

	private constructor(
		apiKey: string,
		model: string,
		voice: string,
		speed: number,
	) {
		this.apiKey = apiKey;
		this.model = model;
		this.voice = voice;
		this.speed = speed;
	}

	static async create(
		config: TTSConfig,
		modelRegistry?: ModelRegistry,
	): Promise<OpenAIProvider> {
		const key = await resolveApiKey(config.apiKey, "openai", modelRegistry);
		if (!key) {
			throw new Error(
				"OpenAI TTS requires API key. " +
					"Either configure OpenAI in pi (run: /login openai) or set apiKey in TTS config.",
			);
		}
		return new OpenAIProvider(
			key,
			config.model || "tts-1",
			config.voice || "alloy",
			config.speed ?? 1.0,
		);
	}

	async synthesize(text: string): Promise<TTSResult> {
		if (!text.trim()) {
			return { ok: false, error: "Text cannot be empty" };
		}

		const mp3Path = createTempPath(".mp3");
		const opusPath = createTempPath(".ogg");

		try {
			// Call OpenAI TTS API
			const response = await fetch("https://api.openai.com/v1/audio/speech", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.model,
					voice: this.voice,
					input: text,
					speed: this.speed,
					response_format: "mp3",
				}),
			});

			if (!response.ok) {
				const body = await response.text();
				throw new Error(`OpenAI API error (${response.status}): ${body.slice(0, 200)}`);
			}

			// Save audio to file
			const arrayBuffer = await response.arrayBuffer();
			fs.writeFileSync(mp3Path, Buffer.from(arrayBuffer));

			// Convert MP3 to OPUS for Telegram
			await this.convertToOpus(mp3Path, opusPath);

			// Clean up intermediate MP3 file
			try {
				fs.unlinkSync(mp3Path);
			} catch {
				/* ignore */
			}

			return { ok: true, audioPath: opusPath };
		} catch (err: any) {
			// Clean up on failure
			try {
				fs.unlinkSync(mp3Path);
			} catch {
				/* ignore */
			}
			try {
				fs.unlinkSync(opusPath);
			} catch {
				/* ignore */
			}
			return { ok: false, error: `OpenAI TTS failed: ${err.message}` };
		}
	}

	/**
	 * Convert MP3 to OPUS format for Telegram voice messages.
	 */
	private convertToOpus(inputPath: string, outputPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			execFile(
				"ffmpeg",
				[
					"-i",
					inputPath,
					"-c:a",
					"libopus",
					"-b:a",
					"24k",
					"-ar",
					"24000",
					"-y",
					outputPath,
				],
				{ timeout: 30_000 },
				(err, _stdout, stderr) => {
					if (err) {
						reject(new Error(`ffmpeg conversion failed: ${stderr?.trim() || err.message}`));
						return;
					}
					resolve();
				},
			);
		});
	}
}

// ── ElevenLabs Provider ─────────────────────────────────────────

/**
 * ElevenLabs TTS API provider.
 * Outputs MP3 by default, converts to OPUS for Telegram.
 */
class ElevenLabsProvider implements TTSProvider {
	private apiKey: string;
	private voiceId: string;
	private model: string;
	private speed: number;

	private constructor(
		apiKey: string,
		voiceId: string,
		model: string,
		speed: number,
	) {
		this.apiKey = apiKey;
		this.voiceId = voiceId;
		this.model = model;
		this.speed = speed;
	}

	static async create(
		config: TTSConfig,
		modelRegistry?: ModelRegistry,
	): Promise<ElevenLabsProvider> {
		const key = await resolveApiKey(config.apiKey, "elevenlabs", modelRegistry);
		if (!key) {
			throw new Error(
				"ElevenLabs TTS requires API key. " +
					"Set apiKey in settings.json under pi-bridge TTS config.",
			);
		}
		return new ElevenLabsProvider(
			key,
			config.voice || "21m00Tcm4TlvDq8ikWAM", // Default: Rachel
			config.model || "eleven_multilingual_v2",
			config.speed ?? 1.0,
		);
	}

	async synthesize(text: string): Promise<TTSResult> {
		if (!text.trim()) {
			return { ok: false, error: "Text cannot be empty" };
		}

		const mp3Path = createTempPath(".mp3");
		const opusPath = createTempPath(".ogg");

		try {
			// Call ElevenLabs TTS API
			const response = await fetch(
				`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
				{
					method: "POST",
					headers: {
						"xi-api-key": this.apiKey,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						text: text,
						model_id: this.model,
						voice_settings: {
							speed: this.speed,
						},
					}),
				},
			);

			if (!response.ok) {
				const body = await response.text();
				throw new Error(`ElevenLabs API error (${response.status}): ${body.slice(0, 200)}`);
			}

			// Save audio to file
			const arrayBuffer = await response.arrayBuffer();
			fs.writeFileSync(mp3Path, Buffer.from(arrayBuffer));

			// Convert MP3 to OPUS for Telegram
			await this.convertToOpus(mp3Path, opusPath);

			// Clean up intermediate MP3 file
			try {
				fs.unlinkSync(mp3Path);
			} catch {
				/* ignore */
			}

			return { ok: true, audioPath: opusPath };
		} catch (err: any) {
			// Clean up on failure
			try {
				fs.unlinkSync(mp3Path);
			} catch {
				/* ignore */
			}
			try {
				fs.unlinkSync(opusPath);
			} catch {
				/* ignore */
			}
			return { ok: false, error: `ElevenLabs TTS failed: ${err.message}` };
		}
	}

	/**
	 * Convert MP3 to OPUS format for Telegram voice messages.
	 */
	private convertToOpus(inputPath: string, outputPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			execFile(
				"ffmpeg",
				[
					"-i",
					inputPath,
					"-c:a",
					"libopus",
					"-b:a",
					"24k",
					"-ar",
					"24000",
					"-y",
					outputPath,
				],
				{ timeout: 30_000 },
				(err, _stdout, stderr) => {
					if (err) {
						reject(new Error(`ffmpeg conversion failed: ${stderr?.trim() || err.message}`));
						return;
					}
					resolve();
				},
			);
		});
	}
}
