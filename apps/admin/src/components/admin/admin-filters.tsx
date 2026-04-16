"use client";

import { Button } from "@ellie/ui";
import { Input } from "@ellie/ui";
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
}

export interface AdminFiltersProps {
	filters: FilterDef[];
	values: Record<string, string>;
	onFilterChange: (key: string, value: string) => void;
	onClearAll?: () => void;
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
								className="h-9 w-[200px] pl-8 pr-8"
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
						<select
							key={filter.key}
							value={values[filter.key] ?? ""}
							onChange={(e) => onFilterChange(filter.key, e.target.value)}
							className="h-9 rounded-md border border-border bg-secondary px-3 text-sm"
						>
							<option value="">{filter.label}</option>
							{filter.options.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
					);
				}

				if (filter.type === "toggle") {
					return (
						<Button
							key={filter.key}
							variant={values[filter.key] === "true" ? "default" : "outline"}
							size="sm"
							className="h-9"
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
				<Button variant="ghost" size="sm" className="h-9" onClick={onClearAll}>
					清除筛选
				</Button>
			)}
		</div>
	);
}
