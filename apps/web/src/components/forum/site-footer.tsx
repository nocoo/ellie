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
		<footer className="relative mt-16 overflow-hidden">
			{/* ── Content area ── */}
			<div className="width-container relative z-10 pb-8">
				<div>
					{/* Branding + copyright */}
					<div className="mb-3">
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
			<div className="width-container relative -mt-16 -top-[280px] mb-[-280px]">
				<div className="mx-[-12.5%]">
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
