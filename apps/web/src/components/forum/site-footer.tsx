// components/forum/site-footer.tsx — Breathable site footer with background art
// Layout: top padding for "breathing space" → content row → background image
// Background image swaps between light/dark mode via CSS class visibility.

import {
	type GlobalFooterViewModel,
	buildGlobalFooterViewModel,
} from "@/viewmodels/forum/footer";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SiteFooterProps {
	vm?: GlobalFooterViewModel;
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
	const m = vm ?? buildGlobalFooterViewModel();

	return (
		<footer className="relative mt-16 overflow-hidden">
			{/* ── Content area ── */}
			<div className="width-container relative z-10 pb-8">
				<div className="grid grid-cols-1 gap-8 sm:grid-cols-12">
					{/* Left column: branding + copyright */}
					<div className="sm:col-span-5">
						<div className="mb-6">
							<span className="text-lg font-bold tracking-tight text-foreground font-display">
								同济网 TONGJI.NET
							</span>
						</div>
						<p className="text-sm text-muted-foreground leading-relaxed">
							&copy; 2002-{new Date().getFullYear()} TONGJI.NET, All rights reserved.
						</p>
					</div>

					{/* Center column: Navigation */}
					<div className="sm:col-span-3 sm:col-start-7">
						<h3 className="mb-4 text-sm font-medium text-muted-foreground">
							导航
						</h3>
						<ul className="space-y-2.5">
							{m.quickLinks.filter((l) => !l.href.startsWith("mailto:")).slice(0, 4).map((link) => (
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
						<h3 className="mb-4 text-sm font-medium text-muted-foreground">
							联系我们
						</h3>
						<ul className="space-y-2.5">
							<li>
								<Link
									href="mailto:hi@tongji.net"
									className="text-sm text-foreground hover:text-primary transition-colors"
								>
									hi@tongji.net
								</Link>
							</li>
							{m.quickLinks.slice(4).map((link) => (
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

			{/* ── Background image — 125% content width, centered ── */}
			<div className="width-container relative -mt-16 -top-[250px] mb-[-250px]">
				<div className="mx-[-12.5%]">
					{/* Light mode image */}
					<img
						src={BG_LIGHT}
						alt=""
						aria-hidden="true"
						className="w-full dark:hidden"
					/>
					{/* Dark mode image */}
					<img
						src={BG_DARK}
						alt=""
						aria-hidden="true"
						className="w-full hidden dark:block"
					/>
				</div>
			</div>
		</footer>
	);
}
