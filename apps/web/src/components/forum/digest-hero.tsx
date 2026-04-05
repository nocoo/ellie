// components/forum/digest-hero.tsx — Digest page hero section
// Displays stats and atmosphere copy for the digest collection

import { Card, CardContent } from "@/components/ui/card";
import { formatCompactNumber } from "@/viewmodels/shared/formatting";
import { Award, BookOpen, Users } from "lucide-react";

interface DigestHeroProps {
	stats: {
		total: number;
		level1: number;
		level2: number;
		level3: number;
	};
	authorCount?: number;
}

export function DigestHero({ stats, authorCount }: DigestHeroProps) {
	return (
		<Card size="sm" className="bg-gradient-to-br from-success/5 via-background to-amber-500/5">
			<CardContent>
				<div className="flex flex-col sm:flex-row sm:items-center gap-4">
					{/* Title and atmosphere */}
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<Award className="h-6 w-6 text-success shrink-0" />
							<h1 className="text-lg font-semibold text-foreground">论坛精华 · 知识殿堂</h1>
						</div>
						<p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
							多年积累的精华，记录着社区最有价值的内容。每一篇都经过精心筛选，值得细细品读。
						</p>
					</div>

					{/* Stats */}
					<div className="flex items-center gap-6 shrink-0">
						<div className="flex items-center gap-2">
							<BookOpen className="h-4 w-4 text-muted-foreground" />
							<div>
								<p className="text-xl font-semibold text-foreground tabular-nums">
									{formatCompactNumber(stats.total)}
								</p>
								<p className="text-xs text-muted-foreground">篇精华</p>
							</div>
						</div>
						{authorCount !== undefined && authorCount > 0 && (
							<div className="flex items-center gap-2">
								<Users className="h-4 w-4 text-muted-foreground" />
								<div>
									<p className="text-xl font-semibold text-foreground tabular-nums">
										{formatCompactNumber(authorCount)}
									</p>
									<p className="text-xs text-muted-foreground">位作者</p>
								</div>
							</div>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
