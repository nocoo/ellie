// components/forum/home-footer.tsx — Homepage-only footer section
// Shows above the global SiteFooter divider. Contains:
// 1. Online member stats (green border bar)
// 2. Friend links header (logo + description)
// 3. Friend links grid

import {
	type HomeFooterViewModel,
	buildHomeFooterViewModel,
} from "@/viewmodels/forum/footer";
import { Settings } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HomeFooterProps {
	vm?: HomeFooterViewModel;
}

// ---------------------------------------------------------------------------
// Layer 1: Online stats bar
// ---------------------------------------------------------------------------

function OnlineStatsBar({ vm }: { vm: HomeFooterViewModel }) {
	const s = vm.onlineStats;

	return (
		<div className="flex items-center justify-between rounded-sm border-l-[3px] border-l-green-500 bg-card px-4 py-2.5">
			<p className="text-[13px] text-foreground">
				在线会员 - 总计{" "}
				<span className="font-bold">{s.totalOnline}</span> 人在线 - 最高记录是{" "}
				<span className="font-bold">{s.peakOnline}</span> 于 {s.peakDate}.
			</p>
			<button
				type="button"
				className="text-dz-stats-text hover:text-foreground transition-colors"
				aria-label="Settings"
			>
				<Settings className="h-4 w-4" />
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 2: Friend links header
// ---------------------------------------------------------------------------

function FriendLinksHeader() {
	return (
		<div className="flex items-start gap-3 rounded-sm border border-border bg-card px-4 py-3">
			{/* Logo */}
			<img
				src="https://t.no.mt/static/image/common/logo_88_31.gif"
				alt="同济网"
				className="h-[31px] w-[88px] flex-shrink-0 mt-0.5"
			/>
			{/* Text */}
			<div>
				<p className="text-[14px] font-bold text-foreground">
					同济大学-同济网-Tongji.Net-欢迎交换友情链接
				</p>
				<p className="mt-0.5 text-[12px] text-dz-stats-text">
					欢迎与我们交换链接，请在加上同济网论坛链接后发信给我们，链接文字：
					同济大学同济网论坛
				</p>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 3: Friend links grid
// ---------------------------------------------------------------------------

function FriendLinksGrid({ vm }: { vm: HomeFooterViewModel }) {
	return (
		<div className="rounded-sm border border-border bg-card px-4 py-3">
			<div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
				{vm.friendLinks.map((link) => (
					<Link
						key={link.label}
						href={link.href}
						className="text-dz-stats-text hover:text-primary transition-colors whitespace-nowrap"
					>
						{link.label}
					</Link>
				))}
				<Link
					href="#"
					className="text-dz-stats-text hover:text-primary transition-colors whitespace-nowrap"
				>
					[更多友情链接]
				</Link>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function HomeFooter({ vm }: HomeFooterProps) {
	const viewModel = vm ?? buildHomeFooterViewModel();

	return (
		<section className="space-y-3">
			<OnlineStatsBar vm={viewModel} />
			<FriendLinksHeader />
			<FriendLinksGrid vm={viewModel} />
		</section>
	);
}
