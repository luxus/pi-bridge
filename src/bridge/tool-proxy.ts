/**
 * pi-bridge — Tool Proxy System.
 *
 * Executes pi tools on behalf of bridge users with permission checking.
 * Supports: read, write, shell, web_search, notify, skills, tts, etc.
 *
 * Security:
 * - Checks if sender is in trustedChatIds
 * - Verifies permission before executing tool
 * - Blocks sensitive operations (restart, config_edit) even for trusted users
 * - Logs all tool executions for security audit
 * - Restricts sensitive paths (.., /, ~)
 */

import { spawn } from "node:child_process";
import type { SecurityConfig } from "../types.ts";

export interface ToolResult {
	ok: boolean;
	response: string;
	error?: string;
	durationMs: number;
}

export interface ToolContext {
	sender: string;
	adapter: string;
	metadata?: Record<string, unknown>;
}

export interface ToolProxyOptions {
	cwd: string;
	timeoutMs: number;
	model?: string | null;
	log: (event: string, data: unknown, level?: string) => void;
}

const SENSITIVE_PATHS = /\.\.|^\/|^~\/|^\//;
const BLOCKED_TOOLS = ["restart", "config_edit"];
const DEFAULT_TRUSTED_PERMISSIONS: Record<string, boolean> = {
	read: true,
	write: true,
	shell: true,
	web_search: true,
	skills: true,
	tts: true,
	restart: false,
	config_edit: false,
};
const DEFAULT_UNTRUSTED_PERMISSIONS: Record<string, boolean> = {
	read: false,
	write: false,
	shell: false,
	web_search: true,
	skills: false,
	tts: false,
};

export class ToolProxy {
	private config: SecurityConfig | undefined;
	private options: ToolProxyOptions;

	constructor(config: SecurityConfig | undefined, options: ToolProxyOptions) {
		this.config = config;
		this.options = options;
	}

	updateConfig(config: SecurityConfig | undefined): void {
		this.config = config;
	}

	/**
	 * Check if a sender is trusted.
	 */
	isTrusted(sender: string): boolean {
		if (!this.config?.trustedChatIds?.length) return false;
		return this.config.trustedChatIds.includes(sender);
	}

	/**
	 * Check if a sender has permission for a specific tool.
	 */
	hasPermission(sender: string, tool: string): boolean {
		const isTrusted = this.isTrusted(sender);
		const permissions = isTrusted
			? { ...DEFAULT_TRUSTED_PERMISSIONS, ...this.config?.trustedPermissions }
			: { ...DEFAULT_UNTRUSTED_PERMISSIONS, ...this.config?.untrustedPermissions };
		return permissions[tool] === true;
	}

	/**
	 * Execute a tool on behalf of a user.
	 */
	async executeTool(
		tool: string,
		args: string[],
		context: ToolContext,
	): Promise<ToolResult> {
		const startTime = Date.now();

		// Check if tool is blocked for everyone
		if (BLOCKED_TOOLS.includes(tool)) {
			this.options.log("tool-blocked", { tool, sender: context.sender, reason: "blocked-tool" }, "WARN");
			return {
				ok: false,
				response: "",
				error: `Tool '${tool}' is blocked for security reasons.`,
				durationMs: Date.now() - startTime,
			};
		}

		// Check permission
		if (!this.hasPermission(context.sender, tool)) {
			this.options.log("tool-denied", { tool, sender: context.sender, trusted: this.isTrusted(context.sender) }, "WARN");
			return {
				ok: false,
				response: "",
				error: `Permission denied: You don't have access to use '${tool}'.`,
				durationMs: Date.now() - startTime,
			};
		}

		// Validate paths for read/write operations
		if (tool === "read" || tool === "write") {
			for (const arg of args) {
				if (SENSITIVE_PATHS.test(arg)) {
					this.options.log("tool-path-blocked", { tool, sender: context.sender, path: arg }, "WARN");
					return {
						ok: false,
						response: "",
						error: `Access denied: Path '${arg}' contains restricted patterns.`,
						durationMs: Date.now() - startTime,
					};
				}
			}
		}

		// Log execution
		this.options.log("tool-execute", { tool, sender: context.sender, args: args.length }, "INFO");

		try {
			const result = await this.runPiTool(tool, args, context);
			this.options.log("tool-complete", { tool, sender: context.sender, ok: result.ok }, "INFO");
			return result;
		} catch (err: any) {
			this.options.log("tool-error", { tool, sender: context.sender, error: err.message }, "ERROR");
			return {
				ok: false,
				response: "",
				error: err.message,
				durationMs: Date.now() - startTime,
			};
		}
	}

	/**
	 * Execute a skill on behalf of a user.
	 */
	async executeSkill(
		skillName: string,
		args: string[],
		context: ToolContext,
	): Promise<ToolResult> {
		const startTime = Date.now();

		// Check skills permission
		if (!this.hasPermission(context.sender, "skills")) {
			this.options.log("skill-denied", { skill: skillName, sender: context.sender }, "WARN");
			return {
				ok: false,
				response: "",
				error: `Permission denied: You don't have access to invoke skills.`,
				durationMs: Date.now() - startTime,
			};
		}

		this.options.log("skill-execute", { skill: skillName, sender: context.sender }, "INFO");

		try {
			const result = await this.runPiSkill(skillName, args, context);
			this.options.log("skill-complete", { skill: skillName, sender: context.sender, ok: result.ok }, "INFO");
			return result;
		} catch (err: any) {
			this.options.log("skill-error", { skill: skillName, sender: context.sender, error: err.message }, "ERROR");
			return {
				ok: false,
				response: "",
				error: err.message,
				durationMs: Date.now() - startTime,
			};
		}
	}

	/**
	 * Run a pi tool via subprocess.
	 */
	private runPiTool(
		tool: string,
		args: string[],
		context: ToolContext,
	): Promise<ToolResult> {
		return new Promise((resolve) => {
			const startTime = Date.now();

			// Build the tool command
			const toolCommand = `/${tool} ${args.join(" ")}`;
			const piArgs = ["-p", "--no-session", toolCommand];

			if (this.options.model) {
				piArgs.push("--model", this.options.model);
			}

			// Prepare environment with sender context
			const env: NodeJS.ProcessEnv = { ...process.env };
			if (context.sender) env.PI_BRIDGE_SENDER = context.sender;
			if (context.metadata) env.PI_BRIDGE_METADATA = JSON.stringify(context.metadata);

			const child = spawn("pi", piArgs, {
				cwd: this.options.cwd,
				stdio: ["ignore", "pipe", "pipe"],
				env,
				timeout: this.options.timeoutMs,
			});

			let stdout = "";
			let stderr = "";

			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			child.on("close", (code) => {
				const durationMs = Date.now() - startTime;
				const exitCode = code ?? 1;

				if (exitCode !== 0) {
					resolve({
						ok: false,
						response: stdout.trim(),
						error: stderr.trim() || `Exit code ${exitCode}`,
						durationMs,
					});
				} else {
					resolve({
						ok: true,
						response: stdout.trim() || "(no output)",
						durationMs,
					});
				}
			});

			child.on("error", (err) => {
				resolve({
					ok: false,
					response: "",
					error: err.message,
					durationMs: Date.now() - startTime,
				});
			});
		});
	}

	/**
	 * Run a pi skill via subprocess.
	 */
	private runPiSkill(
		skillName: string,
		args: string[],
		context: ToolContext,
	): Promise<ToolResult> {
		return new Promise((resolve) => {
			const startTime = Date.now();

			// Build the skill command
			const skillCommand = `/${skillName} ${args.join(" ")}`;
			const piArgs = ["-p", "--no-session", skillCommand];

			if (this.options.model) {
				piArgs.push("--model", this.options.model);
			}

			// Prepare environment with sender context
			const env: NodeJS.ProcessEnv = { ...process.env };
			if (context.sender) env.PI_BRIDGE_SENDER = context.sender;
			if (context.metadata) env.PI_BRIDGE_METADATA = JSON.stringify(context.metadata);

			const child = spawn("pi", piArgs, {
				cwd: this.options.cwd,
				stdio: ["ignore", "pipe", "pipe"],
				env,
				timeout: this.options.timeoutMs,
			});

			let stdout = "";
			let stderr = "";

			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			child.on("close", (code) => {
				const durationMs = Date.now() - startTime;
				const exitCode = code ?? 1;

				if (exitCode !== 0) {
					resolve({
						ok: false,
						response: stdout.trim(),
						error: stderr.trim() || `Exit code ${exitCode}`,
						durationMs,
					});
				} else {
					resolve({
						ok: true,
						response: stdout.trim() || "(no output)",
						durationMs,
					});
				}
			});

			child.on("error", (err) => {
				resolve({
					ok: false,
					response: "",
					error: err.message,
					durationMs: Date.now() - startTime,
				});
			});
		});
	}

	/**
	 * Get available tools and their permission status for a sender.
	 */
	getToolStatus(sender: string): { tool: string; allowed: boolean }[] {
		const tools = ["read", "write", "shell", "web_search", "notify", "skills", "tts"];
		return tools.map(tool => ({
			tool,
			allowed: this.hasPermission(sender, tool),
		}));
	}
}
