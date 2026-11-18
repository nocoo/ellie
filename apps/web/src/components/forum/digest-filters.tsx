// components/forum/digest-filters.tsx — Year and forum filter for digest page
// Client component with search functionality for forum selection

"use client";

import { Button } from "@nocoo/basalt/components/button";
import { Input } from "@nocoo/basalt/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@nocoo/basalt/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { Check, ChevronsUpDown, Search, X } from "@nocoo/basalt/icons";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { DigestFilterForum } from "@/viewmodels/forum/digest.server";

interface DigestFiltersClientProps {
	years: number[];
	forums: DigestFilterForum[];
	currentYear?: number;
	currentForumId?: number;
	currentForumName?: string;
	currentLevel?: number;
}

export function DigestFiltersClient({
	years,
	forums,
	currentYear,
	currentForumId,
	currentForumName,
	currentLevel,
}: DigestFiltersClientProps) {
	const router = useRouter();
	const [forumOpen, setForumOpen] = useState(false);
	const [forumSearch, setForumSearch] = useState("");

	// Build year options for select
	const yearOptions = useMemo(
		() => [
			{ value: "all", label: "全部年份" },
			...years.map((year) => ({ value: String(year), label: `${year} 年` })),
		],
		[years],
	);

	// Filter forums by search keyword
	const filteredForums = useMemo(() => {
		if (!forumSearch.trim()) return forums;
		const keyword = forumSearch.toLowerCase();
		return forums.filter((f) => f.name.toLowerCase().includes(keyword));
	}, [forums, forumSearch]);

	// Build URL with updated filters
	const buildFilterUrl = (params: { year?: number | null; forum?: number | null }) => {
		const searchParams = new URLSearchParams();
		if (currentLevel) searchParams.set("level", String(currentLevel));

		// Year filter
		const newYear = params.year === null ? undefined : (params.year ?? currentYear);
		if (newYear) searchParams.set("year", String(newYear));

		// Forum filter
		const newForum = params.forum === null ? undefined : (params.forum ?? currentForumId);
		if (newForum) searchParams.set("forum", String(newForum));

		const qs = searchParams.toString();
		return qs ? `/digest?${qs}` : "/digest";
	};

	const handleYearChange = (value: string) => {
		if (value === "all") {
			router.push(buildFilterUrl({ year: null }));
		} else {
			router.push(buildFilterUrl({ year: Number.parseInt(value, 10) }));
		}
	};

	const handleForumSelect = (forumId: number) => {
		setForumOpen(false);
		setForumSearch("");
		router.push(buildFilterUrl({ forum: forumId }));
	};

	const handleClearForum = () => {
		router.push(buildFilterUrl({ forum: null }));
	};

	const handleClearAll = () => {
		const params = new URLSearchParams();
		if (currentLevel) params.set("level", String(currentLevel));
		const qs = params.toString();
		router.push(qs ? `/digest?${qs}` : "/digest");
	};

	const hasActiveFilters = currentYear || currentForumId;

	return (
		<div className="flex flex-wrap items-center gap-2 mb-4 rounded-xl border border-basalt-border bg-basalt-muted/20 p-3">
			{/* Year filter */}
			<div className="w-[120px]">
				<Select value={currentYear ? String(currentYear) : "all"} onValueChange={handleYearChange}>
					<select
						id="digest-year"
						className="sr-only"
						value={currentYear ? String(currentYear) : "all"}
						onChange={(event) => handleYearChange(event.target.value)}
					>
						{yearOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<SelectTrigger aria-label="打开精华年份选项" size="sm" className="w-full text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{yearOptions.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Forum filter with search */}
			<Popover open={forumOpen} onOpenChange={setForumOpen}>
				<PopoverTrigger
					className={cn(
						"inline-flex items-center justify-between gap-1 h-8 px-2.5 text-xs rounded-lg border border-basalt-input bg-transparent transition-colors",
						"hover:bg-basalt-accent hover:text-basalt-accent-foreground",
						"focus-visible:border-basalt-ring focus-visible:ring-3 focus-visible:ring-basalt-ring/50 outline-none",
						"min-w-[140px] max-w-[200px]",
						!currentForumId && "text-basalt-muted-foreground",
					)}
				>
					<span className="truncate">{currentForumName || "选择版块"}</span>
					<ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
				</PopoverTrigger>
				<PopoverContent align="start" className="w-[260px] p-2">
					{/* Search input */}
					<div className="relative mb-2">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-basalt-muted-foreground" />
						<Input
							type="text"
							placeholder="搜索版块..."
							aria-label="搜索版块"
							value={forumSearch}
							onChange={(e) => setForumSearch(e.target.value)}
							className="h-8 pl-8 text-xs"
							autoFocus
						/>
					</div>

					{/* Forum list */}
					<div className="max-h-[240px] overflow-y-auto">
						{filteredForums.length === 0 ? (
							<div className="py-4 text-center text-xs text-basalt-muted-foreground">
								未找到版块
							</div>
						) : (
							<div className="space-y-0.5">
								{filteredForums.map((forum) => (
									<button
										key={forum.id}
										type="button"
										onClick={() => handleForumSelect(forum.id)}
										className={cn(
											"flex items-center w-full px-2 py-1.5 text-xs rounded-md transition-colors",
											"hover:bg-basalt-accent hover:text-basalt-accent-foreground",
											currentForumId === forum.id && "bg-basalt-accent",
										)}
									>
										<Check
											className={cn(
												"mr-2 h-3.5 w-3.5 shrink-0",
												currentForumId === forum.id ? "opacity-100" : "opacity-0",
											)}
										/>
										<span className="truncate flex-1 text-left">{forum.name}</span>
										<span className="text-basalt-muted-foreground ml-1">({forum.digestCount})</span>
									</button>
								))}
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>

			{/* Clear filters */}
			{hasActiveFilters && (
				<Button
					variant="ghost"
					size="sm"
					className="h-8 px-2 text-xs text-basalt-muted-foreground hover:text-basalt-foreground"
					onClick={handleClearAll}
				>
					<X className="h-3 w-3 mr-1" />
					清除筛选
				</Button>
			)}

			{/* Active filter badges */}
			{currentYear && (
				<span className="inline-flex items-center gap-1 px-2 py-0.5 bg-basalt-primary/10 text-basalt-primary text-xs rounded-full">
					{currentYear} 年
					<button
						type="button"
						aria-label="清除年份筛选"
						onClick={() => router.push(buildFilterUrl({ year: null }))}
						className="hover:bg-basalt-primary/20 rounded-full p-0.5"
					>
						<X className="h-3 w-3" />
					</button>
				</span>
			)}
			{currentForumName && (
				<span className="inline-flex items-center gap-1 px-2 py-0.5 bg-basalt-primary/10 text-basalt-primary text-xs rounded-full">
					{currentForumName}
					<button
						type="button"
						aria-label="清除版块筛选"
						onClick={handleClearForum}
						className="hover:bg-basalt-primary/20 rounded-full p-0.5"
					>
						<X className="h-3 w-3" />
					</button>
				</span>
			)}
		</div>
	);
}
