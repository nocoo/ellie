// components/forum/jump-to-page.tsx — Client island for jump-to-page input
"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface JumpToPageProps {
	basePath: string;
	pages: number;
}

export function JumpToPage({ basePath, pages }: JumpToPageProps) {
	const router = useRouter();
	const [value, setValue] = useState("");

	function handleGo() {
		const page = Number.parseInt(value, 10);
		if (Number.isNaN(page) || page < 1 || page > pages) return;
		router.push(`${basePath}?page=${page}`);
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
