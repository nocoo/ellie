// components/forum/site-footer.tsx — Forum site footer
// Ref: 04d §SiteFooter — copyright / links / ICP

import Link from "next/link";

export function SiteFooter() {
	const year = new Date().getFullYear();

	return (
		<footer className="border-t border-border bg-background py-6 mt-auto">
			<div className="mx-auto max-w-[1200px] px-4 text-center text-xs text-muted-foreground">
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
