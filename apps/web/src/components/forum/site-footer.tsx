// components/forum/site-footer.tsx — Global Discuz-style site footer
// Shared across ALL pages. Shows the powered-by line, copyright, and quick links.
// The friend-links / online-stats section above is homepage-only (see home-footer.tsx).

import { cn } from "@/lib/utils";
import {
	type GlobalFooterViewModel,
} from "@/viewmodels/forum/footer";
import { Shield } from "lucide-react";
import Link from "next/link";

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
		<footer className="mt-auto border-t border-border bg-background">
			{/* Row 1: Powered by + quick links + ICP + shield icon */}
			<div className="width-container flex items-center justify-between !py-2">
				{/* Left: Powered by */}
				<div className="text-[12px] text-dz-stats-text">
					Powered by{" "}
					<Link href="#" className="font-bold text-foreground hover:underline">
						{vm.poweredBy}
					</Link>
				</div>

				{/* Center: quick links + ICP */}
				<div className="flex items-center gap-0 text-[12px]">
					{vm.quickLinks.map((link, i) => (
						<span key={link.label} className="flex items-center">
							{i > 0 && <FooterSep />}
							<Link
								href={link.href}
								className={cn(
									"text-dz-stats-text hover:text-primary transition-colors",
									i === 0 && "text-primary",
								)}
							>
								{link.label}
							</Link>
						</span>
					))}
					<FooterSep />
					<Link href="#" className="font-bold text-foreground hover:underline">
						同济网（{vm.icpNumber}）
					</Link>
				</div>

				{/* Right: shield icon */}
				<Shield className="h-5 w-5 text-primary" />
			</div>

			{/* Row 2: Copyright + timestamp */}
			<div className="width-container flex items-center justify-between !py-2 border-t border-border">
				{/* Left: copyright */}
				<div className="text-[12px] text-dz-stats-text">
					&copy; {vm.copyrightYears} {vm.copyrightHolder}
				</div>

				{/* Right: timestamp + query stats */}
				<div className="text-[12px] text-dz-stats-text">
					GMT+8, {new Date().toISOString().slice(0, 10)}{" "}
					{new Date().toTimeString().slice(0, 5)} , Processed in 0.043491
					second(s), 777 queries .
				</div>
			</div>
		</footer>
	);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function FooterSep() {
	return (
		<span className="mx-1.5 text-dz-topbar-separator select-none">|</span>
	);
}
