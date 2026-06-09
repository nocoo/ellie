// components/forum/jump-to-page.tsx — Client island for jump-to-page input
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface JumpToPageProps {
	basePath: string;
	pages: number;
	/** Extra query params to append to the navigation URL (e.g. returnTo). */
	extraParams?: Record<string, string>;
}

export function JumpToPage({ basePath, pages, extraParams }: JumpToPageProps) {
	const router = useRouter();
	const [value, setValue] = useState("");

	function handleGo() {
		const page = Number.parseInt(value, 10);
		if (Number.isNaN(page) || page < 1 || page > pages) return;
		// Path-segment canonical:
		//   page 1 → bare basePath
		//   page N → `${basePath}/${N}`
		const path = page > 1 ? `${basePath}/${page}` : basePath;
		if (!extraParams) {
			router.push(path);
			return;
		}
		const params = new URLSearchParams();
		for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
		const qs = params.toString();
		router.push(qs ? `${path}?${qs}` : path);
	}

	return (
		<div className="flex items-center gap-1">
			<span className="text-xs text-muted-foreground whitespace-nowrap">去第</span>
			<input
				type="number"
				min={1}
				max={pages}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => e.key === "Enter" && handleGo()}
				className="h-6 w-12 rounded-md border border-border bg-background px-1.5 text-xs text-center tabular-nums outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
			/>
			<span className="text-xs text-muted-foreground">页</span>
			<Button variant="outline" size="xs" onClick={handleGo}>
				Go
			</Button>
		</div>
	);
}
