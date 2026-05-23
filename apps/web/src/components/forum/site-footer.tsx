// components/forum/site-footer.tsx — Breathable site footer with background art
// Layout: top padding for "breathing space" → content row → background image
// Background image swaps via CSS variable controlled by .dark class.

import { ForumLogo } from "@/components/forum/forum-logo";
import type { GlobalFooterViewModel } from "@/viewmodels/forum/footer";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SiteFooterProps {
	vm: GlobalFooterViewModel;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SiteFooter({ vm }: SiteFooterProps) {
	return (
		<footer className="relative mt-16 overflow-hidden" data-testid="site-footer">
			{/* ── Content area ── */}
			<div className="width-container relative z-10 pb-8">
				<div>
					{/* Branding + copyright. Logo is hidden on mobile per reviewer
					    freeze msg=5a91dfd3 — the footer's only function on phones
					    is the copyright / ICP block, and the decorative logo
					    competes with the background art at narrow widths. */}
					<div className="mb-3 hidden sm:block" data-testid="site-footer-logo-wrap">
						<ForumLogo height={70} lightSrc={vm.logoLight} darkSrc={vm.logoDark} alt={vm.logoAlt} />
					</div>
					<p className="text-xs text-muted-foreground leading-relaxed">
						&copy; {vm.copyrightYears} {vm.copyrightHolder}, All rights reserved.
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{vm.poweredBy} <span className="font-mono">{vm.version}</span>
					</p>
					{vm.icpNumber && <p className="mt-1 text-xs text-muted-foreground">{vm.icpNumber}</p>}
				</div>
			</div>

			{/* ── Background image — 125% content width and centered ── */}
			{/* Uses CSS background-image with .dark class to sync with site theme toggle */}
			{/* Browser only downloads the image for the current theme */}
			{/* Mobile: smaller negative offsets so more of the background art is
			    visible (was being clipped at the top of the band on phones).
			    Mobile also drops the `mx-[-12.5%]` overflow that pushed the
			    image up + off-screen horizontally; the contained image sits
			    flush at the bottom of the footer band. Desktop unchanged. */}
			<div
				className="width-container relative -mt-8 -top-[120px] mb-[-120px] sm:-mt-16 sm:-top-[280px] sm:mb-[-280px]"
				data-testid="site-footer-bg-wrap"
			>
				<div className="mx-0 sm:mx-[-12.5%]">
					<div
						role="img"
						aria-hidden="true"
						className="w-full aspect-[1200/600] bg-contain bg-bottom bg-no-repeat"
						style={
							{
								"--bg-light": `url(${vm.bgLight})`,
								"--bg-dark": `url(${vm.bgDark})`,
								backgroundImage: "var(--bg-light)",
							} as React.CSSProperties
						}
					/>
				</div>
			</div>
		</footer>
	);
}
