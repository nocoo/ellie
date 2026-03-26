// (forum)/search/page.tsx — Search page
// Ref: 04d §搜索 — title prefix / author name search

"use client";

import { Input } from "@/components/ui/input";
import type { SearchType } from "@/viewmodels/forum/search";
import { useState } from "react";

/**
 * Search page — client component for interactive search.
 *
 * Phase 2: Will call executeSearch and display results with pagination.
 */
export default function SearchPage() {
	const [query, setQuery] = useState("");
	const [searchType, setSearchType] = useState<SearchType>("title");

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

			{/* Results placeholder — Phase 2 */}
			<div className="rounded-[14px] bg-card p-6 text-center text-muted-foreground">
				{query.trim() ? `Searching for "${query}"...` : "Enter a search term to find threads."}
			</div>
		</div>
	);
}
