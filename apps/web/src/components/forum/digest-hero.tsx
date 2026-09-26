import { formatNumber } from "@/viewmodels/shared/formatting";
import { DigestIcon } from "./digest-icon";
import { ForumPageHeader } from "./forum-page-header";

export function DigestHero({
	stats,
	authorCount,
}: {
	stats: { total: number; level1: number; level2: number; level3: number };
	authorCount?: number;
}) {
	const metrics = [
		["全部精华", stats.total],
		["精华 I", stats.level1],
		["精华 II", stats.level2],
		["精华 III", stats.level3],
	] as const;
	return (
		<ForumPageHeader
			icon={<DigestIcon level={1} />}
			title="论坛精华"
			description="值得收藏的社区内容，按等级、年份和版块浏览。"
		>
			<dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				{metrics.map(([label, value]) => (
					<div key={label} className="border-l-2 border-primary/20 pl-3">
						<dt className="text-xs text-muted-foreground">{label}</dt>
						<dd className="mt-1 text-xl font-semibold text-foreground tabular-nums">
							{formatNumber(value)}
						</dd>
					</div>
				))}
			</dl>
			{authorCount !== undefined && authorCount > 0 && (
				<p className="mt-3 text-xs text-muted-foreground">
					{formatNumber(authorCount)} 位作者贡献了这些内容
				</p>
			)}
		</ForumPageHeader>
	);
}
