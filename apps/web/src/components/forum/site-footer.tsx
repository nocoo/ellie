// components/forum/site-footer.tsx — Compact forum site footer
// Ref: 04f §3 — removed inner max-w container, reduced padding

import Link from "next/link";

export function SiteFooter() {
	const year = new Date().getFullYear();

	return (
		<footer className="border-t border-border bg-background py-4 mt-auto">
			<div className="text-center text-xs text-muted-foreground">
				<p>
					&copy; {year} 同济网 &middot; Powered by{" "}
					<Link href="/" className="hover:text-foreground transition-colors">
						Ellie
					</Link>
				</p>
				<p className="mt-1">
					<Link href="/privacy" className="hover:text-foreground transition-colors">
						隐私政策
					</Link>
					{" · "}
					<Link href="/terms" className="hover:text-foreground transition-colors">
						使用条款
					</Link>
				</p>
			</div>
		</footer>
	);
}
