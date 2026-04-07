// components/forum/home-footer.tsx — Homepage-only footer section
// Shows above the global SiteFooter. Contains:
// 1. Online member stats (green border bar)
// 2. Friend links section (header + grid) — only shown if links configured

import { ForumLogo } from "@/components/forum/forum-logo";
import type { HomeFooterViewModel } from "@/viewmodels/forum/footer";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

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
		<div className="rounded-sm border-l-[3px] border-l-green-500 bg-card px-4 py-2.5">
			<p className="text-sm text-foreground">
				在线会员 - 总计 <span className="font-bold">{s.totalOnline}</span> 人在线 - 最高记录是{" "}
				<span className="font-bold">{s.peakOnline}</span> 于 {s.peakDate}.
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
		<div className="rounded-sm border border-border bg-card overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-3 border-b border-border bg-gradient-to-r from-forum-header-from to-forum-header-to px-4 py-3">
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
				<div className="flex flex-wrap gap-x-1.5 gap-y-1 text-sm">
					{vm.friendLinks.map((link, idx) => (
						<span key={link.label} className="inline-flex items-center">
							<Link
								href={link.href}
								target="_blank"
								rel="noopener noreferrer"
								className="text-muted-foreground hover:text-primary transition-colors"
							>
								{link.label}
							</Link>
							{idx < vm.friendLinks.length - 1 && <span className="text-border mx-1.5">|</span>}
						</span>
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
