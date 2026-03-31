/**
 * pi-bridge — Scheduler module for cron-based job execution.
 *
 * Supports two job types:
 * - "message": Send static text to a channel
 * - "prompt": Run an LLM prompt and send the result
 */

import type { SchedulerConfig, SchedulerJobConfig, RunResult } from "../types.ts";
import type { ChannelRegistry } from "../registry.ts";
import { runPrompt } from "../bridge/runner.ts";

type LogFn = (event: string, data: unknown, level?: string) => void;
type EventBus = { emit: (event: string, data: unknown) => void };

interface JobState {
	lastRun: number | null;
	runCount: number;
	lastError: string | null;
}

interface JobStats {
	name: string;
	schedule: string;
	channel: string;
	enabled: boolean;
	runCount: number;
	lastRun: number | null;
	nextRun: number | null;
}

/**
 * Parse a single cron field and check if a value matches.
 * Supports: asterisk (any), asterisk-slash-N (step), N (exact), N-comma-M (list), N-dash-M (range)
 */
export function matchesCronField(field: string, value: number, min: number, max: number): boolean {
	if (field === "*") return true;

	if (field.startsWith("*/")) {
		const step = parseInt(field.slice(2), 10);
		if (isNaN(step) || step <= 0) return false;
		return (value - min) % step === 0;
	}

	if (field.includes(",")) {
		const parts = field.split(",");
		return parts.some(p => matchesCronField(p.trim(), value, min, max));
	}

	if (field.includes("-")) {
		const [start, end] = field.split("-").map(p => parseInt(p.trim(), 10));
		if (isNaN(start) || isNaN(end)) return false;
		return value >= start && value <= end;
	}

	const exact = parseInt(field, 10);
	if (isNaN(exact)) return false;
	return value === exact;
}

/**
 * Check if a date matches a 5-field cron expression.
 * Fields: minute(0-59) hour(0-23) day(1-31) month(1-12) dow(0-6, 0=Sunday)
 */
export function matchesCron(expression: string, date: Date): boolean {
	if (!expression || typeof expression !== 'string') return false;
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return false;

	const [minField, hourField, domField, monthField, dowField] = parts;

	const minute = date.getMinutes();
	const hour = date.getHours();
	const dayOfMonth = date.getDate();
	const month = date.getMonth() + 1;
	const dayOfWeek = date.getDay();

	return (
		matchesCronField(minField, minute, 0, 59) &&
		matchesCronField(hourField, hour, 0, 23) &&
		matchesCronField(domField, dayOfMonth, 1, 31) &&
		matchesCronField(monthField, month, 1, 12) &&
		matchesCronField(dowField, dayOfWeek, 0, 6)
	);
}

/**
 * Calculate the next run time for a cron expression.
 * Returns null if no next run found within 1 year.
 */
export function getNextRunTime(expression: string, fromDate: Date = new Date()): number | null {
	const checkDate = new Date(fromDate);
	checkDate.setSeconds(0, 0);
	checkDate.setMinutes(checkDate.getMinutes() + 1);

	const maxIterations = 366 * 24 * 60;
	for (let i = 0; i < maxIterations; i++) {
		if (matchesCron(expression, checkDate)) {
			return checkDate.getTime();
		}
		checkDate.setMinutes(checkDate.getMinutes() + 1);
	}
	return null;
}

export class Scheduler {
	private config: SchedulerConfig;
	private cwd: string;
	private registry: ChannelRegistry;
	private events: EventBus;
	private log: LogFn;
	private interval: ReturnType<typeof setInterval> | null = null;
	private jobStates = new Map<string, JobState>();
	private lastCheckedMinute = -1;

	constructor(
		config: SchedulerConfig,
		cwd: string,
		registry: ChannelRegistry,
		events: EventBus,
		log: LogFn,
	) {
		this.config = config;
		this.cwd = cwd;
		this.registry = registry;
		this.events = events;
		this.log = log;

		for (const [name, job] of Object.entries(config.jobs ?? {})) {
			this.jobStates.set(name, { lastRun: null, runCount: 0, lastError: null });
		}
	}

	start(): void {
		if (this.interval) return;

		this.interval = setInterval(() => {
			this.checkJobs();
		}, 1000);

		this.log("scheduler-started", { jobs: Object.keys(this.config.jobs ?? {}) });
	}

	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		this.log("scheduler-stopped", {});
	}

	private checkJobs(): void {
		const now = new Date();
		const currentMinute = now.getMinutes();

		if (this.lastCheckedMinute === currentMinute) return;
		this.lastCheckedMinute = currentMinute;

		for (const [name, job] of Object.entries(this.config.jobs ?? {})) {
			if (job.enabled === false) continue;
			const schedule = job.cron || job.schedule;
			if (!schedule || !matchesCron(schedule, now)) continue;

			const state = this.jobStates.get(name);
			if (state?.lastRun && now.getTime() - state.lastRun < 60000) continue;

			void this.executeJob(name, job);
		}
	}

	private async executeJob(name: string, job: SchedulerJobConfig): Promise<void> {
		const state = this.jobStates.get(name);
		if (!state) return;

		this.log("job-start", { name, type: job.type });

		try {
			if (job.type === "message") {
				await this.executeMessageJob(name, job);
			} else if (job.type === "prompt") {
				await this.executePromptJob(name, job);
			}

			state.lastRun = Date.now();
			state.runCount++;
			state.lastError = null;
			this.log("job-complete", { name, type: job.type, runs: state.runCount });
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			state.lastError = errorMsg;
			this.log("job-error", { name, error: errorMsg }, "ERROR");
		}
	}

	private async executeMessageJob(name: string, job: SchedulerJobConfig): Promise<void> {
		const content = job.message || job.content || "";
		const adapter = job.adapter || job.channel || "telegram";
		const result = await this.registry.send({
			adapter,
			recipient: job.recipient ?? "",
			text: content,
			source: `cron:${name}`,
		});

		if (!result.ok) {
			throw new Error(result.error ?? "Failed to send message");
		}
	}

	private async executePromptJob(name: string, job: SchedulerJobConfig): Promise<void> {
		const prompt = job.prompt || job.content || "";
		const adapter = job.adapter || job.channel || "telegram";
		
		const result: RunResult = await runPrompt({
			prompt,
			cwd: this.cwd,
			timeoutMs: 300000,
		});

		const text = result.ok
			? result.response
			: `❌ Error: ${result.error ?? "unknown"}`;

		const sendResult = await this.registry.send({
			adapter,
			recipient: job.recipient ?? "",
			text,
			source: `cron:${name}`,
			metadata: { durationMs: result.durationMs, ok: result.ok, voice: job.voice },
		});

		if (!sendResult.ok) {
			throw new Error(sendResult.error ?? "Failed to send prompt result");
		}

		this.events.emit("cron:job_complete", {
			job: { name, channel: adapter, prompt },
			response: result.response,
			ok: result.ok,
			error: result.error,
			durationMs: result.durationMs,
		});
	}

	async runJob(name: string): Promise<boolean> {
		const job = this.config.jobs?.[name];
		if (!job) return false;

		await this.executeJob(name, job);
		return true;
	}

	getStats(): JobStats[] {
		const now = Date.now();
		return Object.entries(this.config.jobs ?? {}).map(([name, job]) => {
			const state = this.jobStates.get(name);
			const schedule = job.cron || job.schedule || "";
			const channel = job.adapter || job.channel || "";
			return {
				name,
				schedule,
				channel,
				enabled: job.enabled !== false,
				runCount: state?.runCount ?? 0,
				lastRun: state?.lastRun ?? null,
				nextRun: job.enabled !== false ? getNextRunTime(schedule, new Date(now)) : null,
			};
		});
	}
}
