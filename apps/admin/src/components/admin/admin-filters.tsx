"use client";

import { Button } from "@ellie/ui";
import { Input } from "@ellie/ui";
import { Select } from "@ellie/ui";
import { Search, X } from "lucide-react";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterDef {
	key: string;
	label: string;
	type: "search" | "select" | "toggle";
	options?: { value: string; label: string }[];
	/**
	 * Optional placeholder shown as the empty (clear-selection) option for
	 * select filters. Falls back to `全部${label}` when omitted. Use this when
	 * `label` is itself one of the option values (e.g. "已锁定") and the
	 * default placeholder would imply a selection has been made.
	 */
	placeholder?: string;
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
 */
export function buildSelectOptions(
	filter: Pick<FilterDef, "label" | "placeholder" | "options">,
): { value: string; label: string }[] {
	return [{ value: "", label: resolveSelectPlaceholder(filter) }, ...(filter.options ?? [])];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminFilters({ filters, values, onFilterChange, onClearAll }: AdminFiltersProps) {
	const [searchInput, setSearchInput] = useState(values.search ?? "");

	const hasActiveFilters = Object.values(values).some((v) => v !== "");

	const handleSearchSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			onFilterChange("search", searchInput);
		},
		[searchInput, onFilterChange],
	);

	const handleSearchClear = useCallback(() => {
		setSearchInput("");
		onFilterChange("search", "");
	}, [onFilterChange]);

	return (
		<div className="flex flex-wrap items-center gap-2">
			{filters.map((filter) => {
				if (filter.type === "search") {
					return (
						<form key={filter.key} onSubmit={handleSearchSubmit} className="relative">
							<Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder={filter.label}
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								className="w-[200px] pl-8 pr-8"
							/>
							{searchInput && (
								<button
									type="button"
									onClick={handleSearchClear}
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
