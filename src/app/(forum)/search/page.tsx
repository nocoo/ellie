// (forum)/search/page.tsx — Search page
// Ref: 04d §搜索 — title prefix / author name search
//
// Client component: interactive search with API-driven results.

"use client";

import { ThreadItem } from "@/components/forum/thread-item";
import { Input } from "@/components/ui/input";
import type { ThreadBadge } from "@/models/thread";
import { decodeHighlight, getThreadBadges } from "@/models/thread";
import type { HighlightStyle } from "@/models/thread";
import type { Thread } from "@/models/types";
import type { SearchType } from "@/viewmodels/forum/search";
import { useCallback, useEffect, useRef, useState } from "react";

interface SearchResult {
	thread: Thread;
	badges: ThreadBadge[];
	highlightStyle: HighlightStyle | null;
}

export default function SearchPage() {
	const [query, setQuery] = useState("");
	const [searchType, setSearchType] = useState<SearchType>("title");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [searching, setSearching] = useState(false);
	const [total, setTotal] = useState(0);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

	const executeSearch = useCallback(async (q: string, type: SearchType) => {
		if (q.trim().length === 0) {
			setResults([]);
			setTotal(0);
			return;
		}

		setSearching(true);
		try {
			const param = type === "title" ? "search" : "author";
			const res = await fetch(`/api/v1/threads?${param}=${encodeURIComponent(q.trim())}`);
			if (!res.ok) return;

			const json = await res.json();
			const items: Thread[] = json.data?.items ?? [];
			setResults(
				items.map((t) => ({
					thread: t,
					badges: getThreadBadges(t),
					highlightStyle: decodeHighlight(t.highlight),
				})),
			);
			setTotal(json.data?.total ?? items.length);
		} catch {
			// Network error — silently ignore
		} finally {
			setSearching(false);
		}
	}, []);

	// Debounced search on query/type change
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		if (query.trim().length === 0) {
			setResults([]);
			setTotal(0);
			return;
		}
		debounceRef.current = setTimeout(() => {
			executeSearch(query, searchType);
		}, 300);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [query, searchType, executeSearch]);

	return (
		<div className="space-y-4">
			<div className="rounded-[14px] bg-card p-6">
				<h1 className="text-2xl font-bold">Search</h1>

				<div className="mt-4 flex gap-2">
					<Input
						placeholder={searchType === "title" ? "Search by title..." : "Search by author..."}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="max-w-md"
					/>
				</div>

				<div className="mt-3 flex gap-2">
					<button
						type="button"
						onClick={() => setSearchType("title")}
						className={`rounded-md px-3 py-1 text-sm transition-colors ${
							searchType === "title"
								? "bg-primary text-primary-foreground"
								: "bg-secondary text-muted-foreground hover:text-foreground"
						}`}
					>
						By Title
					</button>
					<button
						type="button"
						onClick={() => setSearchType("author")}
						className={`rounded-md px-3 py-1 text-sm transition-colors ${
							searchType === "author"
								? "bg-primary text-primary-foreground"
								: "bg-secondary text-muted-foreground hover:text-foreground"
						}`}
					>
						By Author
					</button>
				</div>
			</div>

			{/* Results */}
			<div className="rounded-[14px] bg-card p-4">
				{searching ? (
					<p className="py-4 text-center text-muted-foreground">Searching...</p>
				) : results.length > 0 ? (
					<div className="space-y-2">
						<p className="mb-3 text-sm text-muted-foreground">
							{total} result{total !== 1 ? "s" : ""} found
						</p>
						{results.map((item) => (
							<ThreadItem
								key={item.thread.id}
								thread={item.thread}
								badges={item.badges}
								highlightStyle={item.highlightStyle}
							/>
						))}
					</div>
				) : query.trim() ? (
					<p className="py-4 text-center text-muted-foreground">
						No results found for &quot;{query}&quot;.
					</p>
				) : (
					<p className="py-4 text-center text-muted-foreground">
						Enter a search term to find threads.
					</p>
				)}
			</div>
		</div>
	);
}
