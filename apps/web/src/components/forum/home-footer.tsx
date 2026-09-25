// components/forum/home-footer.tsx — Homepage-only footer section
// Shows above the global SiteFooter. Contains:
// 1. Online member stats (green border bar)
// 2. Friend links section (header + grid) — only shown if links configured

import { Activity, ExternalLink } from "lucide-react";
import Link from "next/link";
import { ForumLogo } from "@/components/forum/forum-logo";
import type { HomeFooterViewModel } from "@/viewmodels/forum/footer";
import { formatNumber } from "@/viewmodels/shared/formatting";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HomeFooterProps {
	vm: HomeFooterViewModel;
}

// ---------------------------------------------------------------------------
// Layer 1: Online stats bar
// ---------------------------------------------------------------------------

function OnlineStatsBar({ vm }: { vm: HomeFooterViewModel }) {
	const s = vm.onlineStats;

	return (
		<div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
			<Activity className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />

			<p
				className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-muted-foreground"
				data-testid="online-stats-line"
			>
				上次统计时活跃会员约 <span className="font-bold">{formatNumber(s.totalOnline)}</span> 人
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 2: Friend links section (header + grid)
// ---------------------------------------------------------------------------

function FriendLinksSection({ vm }: { vm: HomeFooterViewModel }) {
	if (vm.friendLinks.length === 0) {
		return null;
	}

	return (
		<div className="rounded-xl border border-border bg-card overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
				<ForumLogo height={28} />
				<div className="flex-1 min-w-0">
					<h3 className="text-sm font-bold text-foreground truncate">友情链接</h3>
					<p className="text-xs text-muted-foreground truncate">
						欢迎交换链接，请联系 hi@tongji.net
					</p>
				</div>
				<ExternalLink className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
			</div>

			{/* Links grid */}
			<div className="px-4 py-3">
				<div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-2 text-sm">
					{vm.friendLinks.map((link) => (
						<Link
							prefetch={false}
							key={link.label}
							href={link.href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-muted-foreground hover:text-primary transition-colors truncate"
						>
							{link.label}
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function HomeFooter({ vm }: HomeFooterProps) {
	return (
		<section className="space-y-3">
			<OnlineStatsBar vm={vm} />
			<FriendLinksSection vm={vm} />
		</section>
	);
}
