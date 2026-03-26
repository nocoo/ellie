// components/layout/site-footer.tsx — Forum site footer
// Ref: 04d §SiteFooter — Copyright / links / ICP filing

import Link from "next/link";

export interface FooterLink {
	href: string;
	label: string;
}

export const FOOTER_LINKS: FooterLink[] = [
	{ href: "/about", label: "About" },
	{ href: "/terms", label: "Terms" },
	{ href: "/privacy", label: "Privacy" },
];

/** Copyright year range starting from 2006 (Tongji BBS founding) */
export function getCopyrightYear(): string {
	const current = new Date().getFullYear();
	return `2006-${current}`;
}

export function SiteFooter() {
	return (
		<footer className="border-t bg-muted/30 py-6">
			<div className="mx-auto max-w-[1200px] px-4">
				<div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
					{/* Links */}
					<nav className="flex items-center gap-4" aria-label="Footer">
						{FOOTER_LINKS.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								className="hover:text-foreground transition-colors"
							>
								{link.label}
							</Link>
						))}
					</nav>

					{/* Copyright */}
					<p>&copy; {getCopyrightYear()} Tongji.net &middot; Powered by Ellie</p>
				</div>
			</div>
		</footer>
	);
}
