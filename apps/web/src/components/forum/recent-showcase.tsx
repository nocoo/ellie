import type { HomeRecentTopic } from "@ellie/types";
import { MessagesSquare } from "lucide-react";
import { buildRecentShowcaseItem } from "@/viewmodels/forum/home-showcase";
import { HomeShowcase } from "./home-showcase";

export function RecentShowcase({ threads }: { threads: HomeRecentTopic[] }) {
	return (
		<HomeShowcase
			title="最近讨论"
			icon={<MessagesSquare className="size-5 text-primary" aria-hidden="true" />}
			action={<span className="text-xs text-muted-foreground">最新动态</span>}
			emptyText="暂无可展示的讨论"
			items={threads.map(buildRecentShowcaseItem)}
		/>
	);
}
