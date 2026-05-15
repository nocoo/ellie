/**
 * Build `forum_thread_types` rows + per-forum (typeid → name) lookup from
 * the two Discuz sources that together define 主题分类:
 *
 *   1. `pre_forum_forumfield.threadtypes` (parsed into ThreadTypesConfig)
 *      — admin's CURRENT enabled-set: which types the picker shows now,
 *      their names, icons (in icons map), and moderator-only flag. This
 *      is the source-of-truth the admin UI writes to.
 *
 *   2. `pre_forum_threadclass` (parsed into ThreadClassRow)
 *      — per-forum row table that ALSO holds typeid/name/displayorder/
 *      icon/moderators, populated by the same admin paths. Includes
 *      legacy/disabled rows (tombstones) that forumfield.types has since
 *      dropped from the enabled set but old threads still reference via
 *      `thread.typeid`.
 *
 * Reviewer merge policy (msg 73d85116):
 *   • Enabled set = `forumfield.types` (admin's current view).
 *   • For typeids ∈ enabled-set:
 *       name + display_order ← forumfield (admin's current names win;
 *       a threadclass row with a stale name doesn't override).
 *       icon + moderator_only ← forumfield.icons / forumfield.moderators;
 *       fall back to threadclass.icon / threadclass.moderators when
 *       forumfield has no value (DZ admin can write either path).
 *       enabled=1.
 *   • For typeids ∈ threadclass but ∉ forumfield.types:
 *       Insert tombstone row (enabled=0) with threadclass.name / .icon /
 *       .moderators. Lets historical thread.type_id values still resolve
 *       to a human-readable badge in the worker.
 *
 * The pair returned ((rows, perForumNameMap)) is consumed by:
 *   • the load step to INSERT into `forum_thread_types`
 *   • `extractThread` to fill `threads.type_name` per row
 *
 * Both outputs share the same precedence rules so a thread.type_name and
 * the corresponding forum_thread_types.name always agree.
 */

import type { ThreadClassRow } from "../extract/extractors";
import type { RowRecord } from "../load/batch-insert";
import type { ThreadTypesConfig } from "./threadtypes";

/**
 * Build one forum's resolved (typeid → name) map per the merge policy.
 *
 * Split out for unit testability and so the same precedence runs for
 * both the rows-builder and the thread-name resolver.
 */
function resolveTypeNamesForForum(
	config: ThreadTypesConfig | undefined,
	classRows: ThreadClassRow[],
): Map<number, string> {
	const out = new Map<number, string>();
	// Enabled-set names first (admin's current source-of-truth).
	if (config) {
		for (const [typeid, name] of config.types) {
			if (name) out.set(typeid, name);
		}
	}
	// Tombstone names fill in the gaps (typeids in threadclass but not
	// in forumfield.types). We do NOT overwrite an existing entry — the
	// enabled-set's name is canonical.
	for (const row of classRows) {
		if (out.has(row.typeid)) continue;
		if (row.name) out.set(row.typeid, row.name);
	}
	return out;
}

/**
 * Build the global `(fid → typeid → name)` resolution map used by
 * `extractThread` to fill `threads.type_name`. Built once at startup so
 * thread extraction stays O(1) per row.
 *
 * `forumTypeConfigs` keyed by fid; `threadClassByForum` keyed by fid.
 * Forums missing from both inputs simply absent from the result —
 * extractThread falls back to the legacy global threadtype map.
 */
export function buildForumThreadTypeNameMap(
	forumTypeConfigs: Map<number, ThreadTypesConfig>,
	threadClassByForum: Map<number, ThreadClassRow[]>,
): Map<number, Map<number, string>> {
	const out = new Map<number, Map<number, string>>();
	// Union of fids that have either source.
	const fids = new Set<number>();
	for (const fid of forumTypeConfigs.keys()) fids.add(fid);
	for (const fid of threadClassByForum.keys()) fids.add(fid);

	for (const fid of fids) {
		const resolved = resolveTypeNamesForForum(
			forumTypeConfigs.get(fid),
			threadClassByForum.get(fid) ?? [],
		);
		if (resolved.size > 0) out.set(fid, resolved);
	}
	return out;
}

/**
 * Build `forum_thread_types` table rows for a single forum.
 *
 * Output rows match the D1 schema:
 *   (id, forum_id, name, display_order, icon, enabled, moderator_only)
 *
 * - id reuses Discuz typeid directly (PK).
 * - display_order:
 *     enabled rows: index in `forumfield.types` iteration order (Discuz
 *     admin UI persists order via the map's iteration; we mirror that).
 *     tombstone rows: threadclass.displayorder verbatim — these aren't
 *     surfaced in the picker so the exact value matters less, but
 *     keeping the source-side number makes admin debugging easier.
 * - icon: forumfield.icons[typeid] when non-empty, else threadclass.icon.
 * - enabled: 1 if typeid ∈ forumfield.types, else 0 (tombstone).
 * - moderator_only: 1 if forumfield.moderatorOnly has typeid OR the
 *   threadclass row's `moderators` flag is set.
 */
function buildRowsForForum(
	fid: number,
	config: ThreadTypesConfig | undefined,
	classRows: ThreadClassRow[],
): RowRecord[] {
	const resolved = resolveTypeNamesForForum(config, classRows);
	const classByTypeid = new Map<number, ThreadClassRow>();
	for (const row of classRows) classByTypeid.set(row.typeid, row);

	const rows: RowRecord[] = [];
	const seen = new Set<number>();

	// Enabled rows first, preserving forumfield.types iteration order.
	let order = 0;
	if (config) {
		for (const typeid of config.types.keys()) {
			seen.add(typeid);
			const name = resolved.get(typeid) ?? "";
			const cls = classByTypeid.get(typeid);
			const ffIcon = config.icons.get(typeid) ?? "";
			const icon = ffIcon || cls?.icon || "";
			const moderatorOnly = config.moderatorOnly.has(typeid) || (cls?.moderators ?? 0) > 0 ? 1 : 0;
			rows.push({
				id: typeid,
				forum_id: fid,
				name,
				display_order: order++,
				icon,
				enabled: 1,
				moderator_only: moderatorOnly,
			});
		}
	}

	// Tombstone rows: typeids only in threadclass.
	for (const cls of classRows) {
		if (seen.has(cls.typeid)) continue;
		seen.add(cls.typeid);
		rows.push({
			id: cls.typeid,
			forum_id: fid,
			name: cls.name,
			display_order: cls.displayorder,
			icon: cls.icon,
			enabled: 0,
			moderator_only: cls.moderators > 0 ? 1 : 0,
		});
	}

	return rows;
}

/**
 * Build all `forum_thread_types` rows for the entire migration.
 *
 * Rows are emitted in `(forum_id, enabled DESC, display_order, id)`
 * order: enabled rows first per forum (ordered by display_order), then
 * tombstone rows. This keeps the streamed INSERT order stable for
 * dry-run diffing, but the table's PK is `id` alone so order doesn't
 * affect correctness.
 */
export function buildForumThreadTypeRows(
	forumTypeConfigs: Map<number, ThreadTypesConfig>,
	threadClassByForum: Map<number, ThreadClassRow[]>,
): RowRecord[] {
	const out: RowRecord[] = [];
	const fids = new Set<number>();
	for (const fid of forumTypeConfigs.keys()) fids.add(fid);
	for (const fid of threadClassByForum.keys()) fids.add(fid);

	// Sort fids for deterministic output. Numeric ascending mirrors the
	// admin UI's natural ordering (low fids = older forums).
	const sortedFids = [...fids].sort((a, b) => a - b);
	for (const fid of sortedFids) {
		const forumRows = buildRowsForForum(
			fid,
			forumTypeConfigs.get(fid),
			threadClassByForum.get(fid) ?? [],
		);
		for (const r of forumRows) out.push(r);
	}
	return out;
}
