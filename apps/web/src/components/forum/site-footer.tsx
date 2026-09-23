import { FORUM_ART_BASE, siteArtworkBackground } from "@ellie/shared";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ForumLogo } from "@/components/forum/forum-logo";
import type { GlobalFooterViewModel } from "@/viewmodels/forum/footer";

export function SiteFooter({ vm }: { vm: GlobalFooterViewModel }) {
	return (
		<footer
			className="site-footer relative isolate mt-8 overflow-hidden border-t border-border bg-card"
			data-testid="site-footer"
		>
			<div className="site-art-frame width-container" aria-hidden="true">
				<div
					className="site-footer-art max-h-40 sm:max-h-44"
					aria-hidden="true"
					data-testid="site-footer-bg-wrap"
					style={
						{
							"--sketch-light": siteArtworkBackground(vm.bgLight),
							"--sketch-dark": siteArtworkBackground(vm.bgDark),
						} as CSSProperties
					}
				/>
			</div>
			<div className="width-container relative flex min-h-48 flex-wrap items-center justify-between gap-6 pb-6 pt-10 sm:min-h-56 sm:pb-8 sm:pt-14">
				<div className="flex items-center gap-5">
					<div className="hidden sm:block" data-testid="site-footer-logo-wrap">
						<ForumLogo height={40} lightSrc={vm.logoLight} darkSrc={vm.logoDark} alt={vm.logoAlt} />
					</div>
					<div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
						<p>
							&copy; {vm.copyrightYears} {vm.copyrightHolder}, All rights reserved.
						</p>
						<p>
							{vm.poweredBy} <span className="font-mono">{vm.version}</span>
						</p>
						{vm.icpNumber && <p>{vm.icpNumber}</p>}
					</div>
				</div>
				<nav aria-label="页脚导航" className="flex flex-wrap gap-4 text-xs text-muted-foreground">
					<Link href="/" className="hover:text-primary">
						{vm.homeLabel}
					</Link>
					{vm.quickLinks
						.filter((link) => link.href !== "#")
						.map((link) => (
							<a
								key={link.href}
								href={link.href}
								className="inline-flex items-center gap-1 hover:text-primary"
							>
								{link.label}
								<ArrowUpRight className="size-3" aria-hidden="true" />
							</a>
						))}
					<a href={`${FORUM_ART_BASE}/credits.html`} className="hover:text-primary">
						图纹致谢
					</a>
				</nav>
			</div>
		</footer>
	);
}
