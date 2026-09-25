import "server-only";

import {
	applyDailyStatisticsDelta,
	DAILY_STATISTICS_MAX_BYTES,
	DAILY_STATISTICS_PATH,
	type DailyStatistics,
	dailyStatisticsForDay,
	isDailyStatistics,
	STATISTICS_WRITE_HEADER,
	type StatisticsDelta,
} from "@ellie/types";
import { readBoundedJson } from "./memory-runtime";

const REFRESH_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const MAX_BYTES = DAILY_STATISTICS_MAX_BYTES;

type Loader = () => Promise<DailyStatistics | null>;

async function fetchStatistics(): Promise<DailyStatistics | null> {
	const origin = process.env.WORKER_API_URL;
	const secret = process.env.WEB_STATISTICS_WRITE_KEY;
	if (!origin || !secret) return null;
	const response = await fetch(new URL(DAILY_STATISTICS_PATH, origin), {
		headers: { [STATISTICS_WRITE_HEADER]: secret },
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error("Statistics snapshot unavailable");
	const payload = await readBoundedJson(response, MAX_BYTES);
	if (!payload || typeof payload !== "object" || !("data" in payload)) {
		throw new Error("Invalid statistics snapshot envelope");
	}
	if (payload.data === null) return null;
	if (!isDailyStatistics(payload.data)) throw new Error("Invalid statistics snapshot");
	return payload.data;
}

export class DailyStatisticsMemory {
	private snapshot: DailyStatistics | null = null;
	private flight: Promise<void> | null = null;
	private nextReadAt = 0;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly load: Loader = fetchStatistics,
		private readonly now = Date.now,
	) {}

	peek(): DailyStatistics | null {
		return this.snapshot ? dailyStatisticsForDay(this.snapshot, this.now()) : null;
	}

	async read(): Promise<DailyStatistics | null> {
		if (!this.snapshot && this.now() >= this.nextReadAt) await this.refresh();
		return this.peek();
	}

	refresh(): Promise<void> {
		if (this.flight) return this.flight;
		this.flight = Promise.resolve()
			.then(async () => {
				this.nextReadAt = this.now() + RETRY_MS;
				try {
					const snapshot = await this.load();
					if (
						snapshot &&
						isDailyStatistics(snapshot) &&
						Buffer.byteLength(JSON.stringify(snapshot)) <= MAX_BYTES
					) {
						if (!this.snapshot || snapshot.generatedAt >= this.snapshot.generatedAt)
							this.snapshot = snapshot;
						this.nextReadAt = this.now() + REFRESH_MS;
					}
				} catch {
					console.warn("[statistics] retaining previous snapshot after refresh failure");
				}
			})
			.finally(() => {
				this.flight = null;
			});
		return this.flight;
	}

	optimistic(delta: StatisticsDelta): void {
		if (this.snapshot) this.snapshot = applyDailyStatisticsDelta(this.snapshot, delta, this.now());
	}

	start(): void {
		if (this.timer) return;
		void this.refresh();
		this.timer = setInterval(() => {
			if (this.now() >= this.nextReadAt) void this.refresh();
		}, 60_000);
		this.timer.unref?.();
	}

	stop(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}
}

const state = globalThis as typeof globalThis & { __ellieDailyStatistics?: DailyStatisticsMemory };
export function getDailyStatistics(): DailyStatisticsMemory {
	state.__ellieDailyStatistics ??= new DailyStatisticsMemory();
	return state.__ellieDailyStatistics;
}
