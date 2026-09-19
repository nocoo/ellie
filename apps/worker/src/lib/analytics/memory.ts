import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import type { AggregateRow, PathKind } from "./types";

interface VisitTarget {
	pathKind: PathKind;
	targetId: number;
	views: number;
	humanViews: number;
	botSearchViews: number;
	botOtherViews: number;
	unknownViews: number;
	uniqueUsers: null;
	firstSeenAt: number;
	lastSeenAt: number;
}

/** One site/day actor, intentionally no storage, alarms, D1 or KV writes. */
export class TodayVisitsMemory extends DurableObject<Env> {
	private readonly targets = new Map<string, VisitTarget>();
	private readonly startedAt = Math.floor(Date.now() / 1000);
	private droppedViews = 0;

	ingest(rows: AggregateRow[]): void {
		for (const sample of rows) {
			const key = `${sample.pathKind}#${sample.targetId}`;
			let row = this.targets.get(key);
			if (!row) {
				// ponytail: bound optional telemetry at 20k targets/day; no disk overflow.
				if (this.targets.size >= 20_000) {
					this.droppedViews += sample.count;
					continue;
				}
				row = {
					pathKind: sample.pathKind,
					targetId: sample.targetId,
					views: 0,
					humanViews: 0,
					botSearchViews: 0,
					botOtherViews: 0,
					unknownViews: 0,
					uniqueUsers: null,
					firstSeenAt: sample.firstSeenAt,
					lastSeenAt: sample.lastSeenAt,
				};
				this.targets.set(key, row);
			}
			row.views += sample.count;
			const field = {
				human: "humanViews",
				bot_search: "botSearchViews",
				bot_other: "botOtherViews",
				unknown: "unknownViews",
			} as const;
			row[field[sample.botClass]] += sample.count;
			row.firstSeenAt = Math.min(row.firstSeenAt, sample.firstSeenAt);
			row.lastSeenAt = Math.max(row.lastSeenAt, sample.lastSeenAt);
		}
	}

	kpi(dateLocal: string) {
		const totals = {
			totalViews: 0,
			humanViews: 0,
			botSearchViews: 0,
			botOtherViews: 0,
			unknownViews: 0,
		};
		const kinds = new Map<PathKind, { pathKind: PathKind; views: number; targets: number }>();
		for (const row of this.targets.values()) {
			totals.totalViews += row.views;
			for (const field of [
				"humanViews",
				"botSearchViews",
				"botOtherViews",
				"unknownViews",
			] as const)
				totals[field] += row[field];
			const kind = kinds.get(row.pathKind) ?? { pathKind: row.pathKind, views: 0, targets: 0 };
			kind.views += row.views;
			kind.targets++;
			kinds.set(row.pathKind, kind);
		}
		return {
			now: Math.floor(Date.now() / 1000),
			dateLocal,
			...totals,
			distinctTargets: this.targets.size,
			activeUsers: null,
			anonPresent: null,
			byPathKind: [...kinds.values()].sort(
				(a, b) => b.views - a.views || a.pathKind.localeCompare(b.pathKind),
			),
			startedAt: this.startedAt,
			droppedViews: this.droppedViews,
		};
	}

	list(pathKind: PathKind | null, page: number, limit: number) {
		const rows = [...this.targets.values()]
			.filter((row) => pathKind === null || row.pathKind === pathKind)
			.sort(
				(a, b) =>
					b.views - a.views ||
					b.lastSeenAt - a.lastSeenAt ||
					a.pathKind.localeCompare(b.pathKind) ||
					a.targetId - b.targetId,
			);
		return { page, limit, total: rows.length, rows: rows.slice((page - 1) * limit, page * limit) };
	}
}
