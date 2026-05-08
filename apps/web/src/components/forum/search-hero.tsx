// components/forum/search-hero.tsx — Search page hero section
// Displays search atmosphere with gradient background

import { Card, CardContent } from "@/components/ui/card";
import { Search } from "lucide-react";

export function SearchHero() {
	return (
		<Card size="sm" className="bg-gradient-to-br from-violet-500/5 via-background to-purple-500/5">
			<CardContent>
				<div className="flex items-center gap-2">
					<Search className="h-6 w-6 text-primary shrink-0" />
					<h1 className="text-lg font-semibold text-foreground">搜索</h1>
				</div>
				<p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
					搜索论坛主题和用户，快速找到你需要的内容
				</p>
			</CardContent>
		</Card>
	);
}
