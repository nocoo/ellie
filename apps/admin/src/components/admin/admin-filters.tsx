"use client";

import { Button, Input, Select } from "@ellie/ui";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterDef {
	key: string;
	label: string;
	type: "search" | "select" | "toggle" | "numrange" | "daterange";
	options?: { value: string; label: string }[];
	/**
	 * Optional placeholder shown as the empty (clear-selection) option for
	 * select filters. Falls back to `全部${label}` when omitted. Use this when
	 * `label` is itself one of the option values (e.g. "已锁定") and the
	 * default placeholder would imply a selection has been made.
	 */
	placeholder?: string;
	/**
	 * Range filter (numrange / daterange) only — placeholder text for the
	 * lower / upper bound inputs. Defaults to `最小` / `最大` for numrange
	 * and `开始日期` / `结束日期` for daterange.
	 */
	minPlaceholder?: string;
	maxPlaceholder?: string;
}

export interface AdminFiltersProps {
	filters: FilterDef[];
	values: Record<string, string>;
	onFilterChange: (key: string, value: string) => void;
	onClearAll?: () => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Resolve the placeholder text shown as the empty (clear-selection) option
 * for a select filter. Defaults to `全部${label}` when not specified, so the
 * empty state never reads like one of the option values (e.g. "已锁定").
 */
export function resolveSelectPlaceholder(filter: Pick<FilterDef, "label" | "placeholder">): string {
	return filter.placeholder ?? `全部${filter.label}`;
}

/**
 * Build the option list for a select filter, with the empty-value option
 * (used to clear the filter) prepended.
 *
 * Defensively strips any existing empty-value entries from `filter.options`
 * so the caller can pass option lists that already include an "all" entry
 * (e.g. `REPORT_STATUS_OPTIONS`) without producing duplicate React keys.
 */
export function buildSelectOptions(
	filter: Pick<FilterDef, "label" | "placeholder" | "options">,
): { value: string; label: string }[] {
	const filtered = (filter.options ?? []).filter((opt) => opt.value !== "");
	return [{ value: "", label: resolveSelectPlaceholder(filter) }, ...filtered];
}

/**
 * Range filters store their two bounds in the `values` map under the keys
 * `${key}Min` and `${key}Max`. Centralise the suffix so the component, the
 * viewmodels, and the worker query-param naming all agree.
 */
export function rangeMinKey(key: string): string {
	return `${key}Min`;
}
export function rangeMaxKey(key: string): string {
	return `${key}Max`;
}

/**
 * Convert an HTML date input value (`YYYY-MM-DD`, local-day semantics) to
 * a unix-seconds bound. `Start` returns 00:00:00 of that local day; `End`
 * returns 23:59:59 of that local day. Returns `null` for empty / malformed
 * / out-of-range input so the caller can drop the bound silently.
 *
 * Inclusive on both ends — matches `range` filter semantics in worker
 * `crud.ts` (`column >= ?Min AND column <= ?Max`).
 */
function parseDateInput(yyyymmdd: string): { y: number; m: number; d: number } | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd.trim());
	if (!match) return null;
	const y = Number(match[1]);
	const m = Number(match[2]);
	const d = Number(match[3]);
	if (m < 1 || m > 12 || d < 1 || d > 31) return null;
	return { y, m, d };
}

function buildDate(y: number, m: number, d: number, h: number, mi: number, s: number): Date | null {
	const date = new Date(y, m - 1, d, h, mi, s, 0);
	// Reject invalid calendar dates (e.g. Feb 30 → Mar 2 rollover).
	if (
		date.getFullYear() !== y ||
		date.getMonth() !== m - 1 ||
		date.getDate() !== d ||
		Number.isNaN(date.getTime())
	) {
		return null;
	}
	return date;
}

export function dateInputToUnixSecondsStart(yyyymmdd: string): number | null {
	const parts = parseDateInput(yyyymmdd);
	if (!parts) return null;
	const date = buildDate(parts.y, parts.m, parts.d, 0, 0, 0);
	return date ? Math.floor(date.getTime() / 1000) : null;
}

export function dateInputToUnixSecondsEnd(yyyymmdd: string): number | null {
	const parts = parseDateInput(yyyymmdd);
	if (!parts) return null;
	const date = buildDate(parts.y, parts.m, parts.d, 23, 59, 59);
	return date ? Math.floor(date.getTime() / 1000) : null;
}

/**
 * Normalise a numeric range bound from a raw input string. Returns the
 * numeric string for safe URL-param use, or `null` if empty / not finite.
 * `0` is a valid bound — explicit `Number.isFinite` guard, not truthy.
 */
export function normalizeNumRangeBound(raw: string): string | null {
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	const n = Number(trimmed);
	return Number.isFinite(n) ? String(n) : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminFilters({ filters, values, onFilterChange, onClearAll }: AdminFiltersProps) {
	// H.2.1 — search inputs are per-filter-key, not a single shared slot.
	// The previous implementation kept one `searchInput` state and hard-coded
	// `onFilterChange("search", …)` in both submit and clear, so any page
	// that defined more than one `type: "search"` filter would have both
	// boxes share a single buffer AND every submit overwrite `values.search`
	// regardless of which box was used — making the "secondary" search
	// box completely non-functional.
	//
	// Local input state holds the pending (un-submitted) text per filter
	// key. It mirrors `values[key]` on mount and stays in sync when the
	// parent clears the filter (e.g. "清除筛选" → values=empty); local
	// keystrokes are NOT pushed up until the user presses Enter or clicks
	// the inline `<X>` clear button. This preserves the existing "search
	// triggers on submit, not per-keystroke" UX.
	const [searchInputs, setSearchInputs] = useState<Record<string, string>>(() => {
		const initial: Record<string, string> = {};
		for (const f of filters) if (f.type === "search") initial[f.key] = values[f.key] ?? "";
		return initial;
	});

	// H.2.1.1 — the parent→local sync must only fire on an actual
	// TRANSITION of `values[key]` from non-empty to empty (the real
	// "parent cleared this filter" signal). The naive version compared
	// only the current `parentVal` to "", which would fire every time
	// the parent re-rendered with `values.search === ""` — including
	// while the user was typing into an unsubmitted search box. The
	// bug: type "hel" into the subject box (local="hel",
	// parent.search=""), then change the forum dropdown → parent
	// rebuilds `values` (new object identity, search still "") → effect
	// fires and snaps local back to "" → user's pending text vanishes.
	//
	// We track the previous values via `useRef` and only treat
	// `prev[key] !== "" && current[key] === ""` as a parent-driven
	// clear. Initial mount sees prev === current, so no spurious clear.
	const prevValuesRef = useRef(values);
	useEffect(() => {
		const prev = prevValuesRef.current;
		const cur = values;
		prevValuesRef.current = cur;
		setSearchInputs((prevState) => {
			const next: Record<string, string> = { ...prevState };
			let changed = false;
			for (const f of filters) {
				if (f.type !== "search") continue;
				// Seed any newly-introduced search key with the current
				// parent value (filter list may grow at runtime).
				if (!(f.key in next)) {
					next[f.key] = cur[f.key] ?? "";
					changed = true;
					continue;
				}
				// Treat only an actual prev→cur clear as a parent reset.
				const prevVal = prev[f.key] ?? "";
				const curVal = cur[f.key] ?? "";
				if (prevVal !== "" && curVal === "" && next[f.key] !== "") {
					next[f.key] = "";
					changed = true;
				}
			}
			return changed ? next : prevState;
		});
	}, [filters, values]);

	const hasActiveFilters = Object.values(values).some((v) => v !== "");

	const handleSearchInputChange = useCallback((key: string, value: string) => {
		setSearchInputs((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleSearchSubmit = useCallback(
		(key: string, e: React.FormEvent) => {
			e.preventDefault();
			onFilterChange(key, searchInputs[key] ?? "");
		},
		[searchInputs, onFilterChange],
	);

	const handleSearchClear = useCallback(
		(key: string) => {
			setSearchInputs((prev) => ({ ...prev, [key]: "" }));
			onFilterChange(key, "");
		},
		[onFilterChange],
	);

	return (
		<div className="flex flex-wrap items-center gap-2">
			{filters.map((filter) => {
				if (filter.type === "search") {
					const inputVal = searchInputs[filter.key] ?? "";
					return (
						<form
							key={filter.key}
							onSubmit={(e) => handleSearchSubmit(filter.key, e)}
							className="relative"
						>
							<Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder={filter.label}
								value={inputVal}
								onChange={(e) => handleSearchInputChange(filter.key, e.target.value)}
								aria-label={filter.label}
								className="w-[200px] pl-8 pr-8"
							/>
							{inputVal && (
								<button
									type="button"
									onClick={() => handleSearchClear(filter.key)}
									aria-label={`清除${filter.label}`}
									className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</form>
					);
				}

				if (filter.type === "select" && filter.options) {
					return (
						<Select
							key={filter.key}
							value={values[filter.key] ?? ""}
							onChange={(e) => onFilterChange(filter.key, e.target.value)}
							aria-label={filter.label}
							options={buildSelectOptions(filter)}
						/>
					);
				}

				if (filter.type === "toggle") {
					return (
						<Button
							key={filter.key}
							variant={values[filter.key] === "true" ? "default" : "outline"}
							onClick={() =>
								onFilterChange(filter.key, values[filter.key] === "true" ? "" : "true")
							}
						>
							{filter.label}
						</Button>
					);
				}

				if (filter.type === "numrange") {
					const minKey = rangeMinKey(filter.key);
					const maxKey = rangeMaxKey(filter.key);
					return (
						<div key={filter.key} className="flex items-center gap-1">
							<span className="text-sm text-muted-foreground">{filter.label}</span>
							<Input
								type="number"
								inputMode="numeric"
								value={values[minKey] ?? ""}
								onChange={(e) => onFilterChange(minKey, e.target.value)}
								placeholder={filter.minPlaceholder ?? "最小"}
								aria-label={`${filter.label} 最小`}
								className="w-[88px]"
							/>
							<span className="text-sm text-muted-foreground">—</span>
							<Input
								type="number"
								inputMode="numeric"
								value={values[maxKey] ?? ""}
								onChange={(e) => onFilterChange(maxKey, e.target.value)}
								placeholder={filter.maxPlaceholder ?? "最大"}
								aria-label={`${filter.label} 最大`}
								className="w-[88px]"
							/>
						</div>
					);
				}

				if (filter.type === "daterange") {
					const minKey = rangeMinKey(filter.key);
					const maxKey = rangeMaxKey(filter.key);
					return (
						<div key={filter.key} className="flex items-center gap-1">
							<span className="text-sm text-muted-foreground">{filter.label}</span>
							<Input
								type="date"
								value={values[minKey] ?? ""}
								onChange={(e) => onFilterChange(minKey, e.target.value)}
								placeholder={filter.minPlaceholder ?? "开始日期"}
								aria-label={`${filter.label} 开始日期`}
								className="w-[150px]"
							/>
							<span className="text-sm text-muted-foreground">—</span>
							<Input
								type="date"
								value={values[maxKey] ?? ""}
								onChange={(e) => onFilterChange(maxKey, e.target.value)}
								placeholder={filter.maxPlaceholder ?? "结束日期"}
								aria-label={`${filter.label} 结束日期`}
								className="w-[150px]"
							/>
						</div>
					);
				}

				return null;
			})}

			{hasActiveFilters && onClearAll && (
				<Button variant="ghost" onClick={onClearAll}>
					清除筛选
				</Button>
			)}
		</div>
	);
}
