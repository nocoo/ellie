// components/forum/thread-sort-controls.tsx — URL-driven sort/filter controls
// Ref: 04d §版块帖子列表 — sort by latest/newest/hot + digest toggle
//
// Client component: navigates via URL search params on click.
// Works correctly with server-component pages (no empty callbacks).

"use client";

import type { ThreadSort } from "@/viewmodels/forum/thread-list";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export const SORT_OPTIONS: { value: ThreadSort; label: string }[] = [
	{ value: "latest", label: "Latest Reply" },
	{ value: "newest", label: "Newest" },
	{ value: "hot", label: "Hot" },
];

export interface ThreadSortControlsProps {
	sort: ThreadSort;
	digestOnly: boolean;
}

export function ThreadSortControls({ sort, digestOnly }: ThreadSortControlsProps) {
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
		<div className="mb-3 flex flex-wrap items-center gap-2">
			{SORT_OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => navigate({ sort: option.value === "latest" ? null : option.value })}
					className={`rounded-md px-3 py-1 text-sm transition-colors ${
						sort === option.value
							? "bg-primary text-primary-foreground"
							: "bg-secondary text-muted-foreground hover:text-foreground"
					}`}
				>
					{option.label}
				</button>
			))}
			<button
				type="button"
				onClick={() => navigate({ digest: digestOnly ? null : "true" })}
				className={`rounded-md px-3 py-1 text-sm transition-colors ${
					digestOnly
						? "bg-primary text-primary-foreground"
						: "bg-secondary text-muted-foreground hover:text-foreground"
				}`}
			>
				Digest Only
			</button>
		</div>
	);
}
