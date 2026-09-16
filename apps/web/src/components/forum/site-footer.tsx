import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ForumLogo } from "@/components/forum/forum-logo";
import type { GlobalFooterViewModel } from "@/viewmodels/forum/footer";

export function SiteFooter({ vm }: { vm: GlobalFooterViewModel }) {
	return (
		<footer
			className="relative mt-8 overflow-hidden border-t border-border bg-card"
			data-testid="site-footer"
		>
			<div
				className="pointer-events-none absolute inset-y-0 right-0 w-2/3 max-w-2xl opacity-15"
				aria-hidden="true"
				data-testid="site-footer-bg-wrap"
			>
				<div
					className="h-full w-full bg-cover bg-center"
					style={
						{
							"--bg-light": `url(${vm.bgLight})`,
							"--bg-dark": `url(${vm.bgDark})`,
							backgroundImage: "var(--bg-light)",
						} as CSSProperties
					}
				/>
			</div>
			<div className="width-container relative flex flex-wrap items-center justify-between gap-6 py-6 sm:py-8">
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
				</nav>
			</div>
		</footer>
	);
}
