// components/forum/site-footer.tsx — Breathable site footer with background art
// Layout: top padding for "breathing space" → content row → background image
// Background image swaps between light/dark mode via CSS class visibility.

import { ForumLogo } from "@/components/forum/forum-logo";
import type { GlobalFooterViewModel } from "@/viewmodels/forum/footer";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SiteFooterProps {
	vm: GlobalFooterViewModel;
}

// ---------------------------------------------------------------------------
// Background image URLs — light & dark variants
// ---------------------------------------------------------------------------

const BG_LIGHT = "https://t.no.mt/ellie/bg_footer_light_01.jpg";
const BG_DARK = "https://t.no.mt/ellie/bg_footer_dark_01.jpg";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SiteFooter({ vm }: SiteFooterProps) {
	return (
		<footer className="relative mt-16 overflow-hidden">
			{/* ── Content area ── */}
			<div className="width-container relative z-10 pb-8">
				<div className="grid grid-cols-1 gap-8 sm:grid-cols-12">
					{/* Left column: branding + copyright */}
					<div className="sm:col-span-5">
						<div className="mb-3">
							<ForumLogo height={70} />
						</div>
						<p className="text-xs text-muted-foreground leading-relaxed">
							&copy; {vm.copyrightYears} {vm.copyrightHolder}, All rights reserved.
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							{vm.poweredBy} <span className="font-mono">{vm.version}</span>
						</p>
						{vm.icpNumber && <p className="mt-1 text-xs text-muted-foreground">{vm.icpNumber}</p>}
					</div>

					{/* Center column: Navigation */}
					<div className="sm:col-span-3 sm:col-start-7">
						<h3 className="mb-4 text-sm font-medium text-muted-foreground">导航</h3>
						<ul className="space-y-2.5">
							{vm.quickLinks
								.filter((l) => !l.href.startsWith("mailto:"))
								.slice(0, 4)
								.map((link) => (
									<li key={link.label}>
										<Link
											href={link.href}
											className="text-sm text-foreground hover:text-primary transition-colors"
										>
											{link.label}
										</Link>
									</li>
								))}
						</ul>
					</div>

					{/* Right column: Contact */}
					<div className="sm:col-span-3 sm:col-start-10">
						<h3 className="mb-4 text-sm font-medium text-muted-foreground">联系我们</h3>
						<ul className="space-y-2.5">
							<li>
								<Link
									href="mailto:hi@tongji.net"
									className="text-sm text-foreground hover:text-primary transition-colors"
								>
									hi@tongji.net
								</Link>
							</li>
							{vm.quickLinks.slice(4).map((link) => (
								<li key={link.label}>
									<Link
										href={link.href}
										className="text-sm text-foreground hover:text-primary transition-colors"
									>
										{link.label}
									</Link>
								</li>
							))}
						</ul>
					</div>
				</div>
			</div>

			{/* ── Background image — 125% content width and centered ── */}
			<div className="width-container relative -mt-16 -top-[250px] mb-[-250px]">
				<div className="mx-[-12.5%]">
					{/* Light mode image */}
					<img src={BG_LIGHT} alt="" aria-hidden="true" className="w-full dark:hidden" />
					{/* Dark mode image */}
					<img src={BG_DARK} alt="" aria-hidden="true" className="w-full hidden dark:block" />
				</div>
			</div>
		</footer>
	);
}
