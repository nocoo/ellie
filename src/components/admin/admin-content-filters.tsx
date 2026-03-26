// components/admin/admin-content-filters.tsx — URL-driven content moderation filters
// Ref: 04c §内容审核 — threads/posts tab switch + forum filter
//
// Client component: navigates via URL search params on change.

"use client";

import type { ContentTab } from "@/viewmodels/admin/content-moderation";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const TAB_OPTIONS: { value: ContentTab; label: string }[] = [
	{ value: "threads", label: "Threads" },
	{ value: "posts", label: "Posts" },
];

export interface AdminContentFiltersProps {
	tab: ContentTab;
	forumId: string;
	forums: { id: number; name: string }[];
}

export function AdminContentFilters({ tab, forumId, forums }: AdminContentFiltersProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const navigate = useCallback(
		(params: Record<string, string | null>) => {
			const sp = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(params)) {
				if (value === null || value === "") {
					sp.delete(key);
				} else {
					sp.set(key, value);
				}
			}
			const qs = sp.toString();
			router.push(qs ? `${pathname}?${qs}` : pathname);
		},
		[router, pathname, searchParams],
	);

	return (
		<div className="flex flex-wrap items-center gap-3">
			{/* Tab switch: threads / posts */}
			<div className="flex rounded-md border border-border">
				{TAB_OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						onClick={() => navigate({ tab: option.value === "threads" ? null : option.value })}
						className={`px-4 py-1.5 text-sm transition-colors first:rounded-l-md last:rounded-r-md ${
							tab === option.value
								? "bg-primary text-primary-foreground"
								: "bg-background text-muted-foreground hover:text-foreground"
						}`}
					>
						{option.label}
					</button>
				))}
			</div>

			{/* Forum filter */}
			<select
				value={forumId}
				onChange={(e) => navigate({ forumId: e.target.value || null })}
				className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
			>
				<option value="">All Forums</option>
				{forums.map((f) => (
					<option key={f.id} value={String(f.id)}>
						{f.name}
					</option>
				))}
			</select>
		</div>
	);
}
