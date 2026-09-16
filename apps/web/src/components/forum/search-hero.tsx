import { Search } from "lucide-react";
import { ForumPageHeader } from "./forum-page-header";

export function SearchHero() {
	return (
		<ForumPageHeader
			icon={<Search />}
			title="搜索"
			description="按关键词查找论坛主题，找回有用的经验与讨论。"
		/>
	);
}
