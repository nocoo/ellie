import type { Env } from "../env";
import type { AggregateRow } from "./types";

export function todayVisitsMemory(env: Env, dateLocal: string) {
	if (!env.TODAY_VISITS) throw new Error("Today visits memory binding is not configured");
	return env.TODAY_VISITS.getByName(`visits:${dateLocal}`);
}

/** Preserve the existing 30-second batching, but never persist page views. */
export async function memoryFlushSink(env: Env, rows: AggregateRow[]): Promise<void> {
	const days = new Map<string, AggregateRow[]>();
	for (const row of rows) {
		const batch = days.get(row.dateLocal) ?? [];
		batch.push(row);
		days.set(row.dateLocal, batch);
	}
	for (const [date, batch] of days) await todayVisitsMemory(env, date).ingest(batch);
}
