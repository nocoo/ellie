// components/breadcrumbs.tsx — Generic breadcrumb navigation
// Ref: 04b §共享布局组件 — Breadcrumbs

import { cn } from "@/lib/utils";
import { ChevronRight, Home } from "lucide-react";
import Link from "next/link";

export interface BreadcrumbItem {
	label: string;
	href?: string;
}

export interface BreadcrumbsProps {
	items: BreadcrumbItem[];
	/** Show home icon as first item. Default: true */
	showHome?: boolean;
	className?: string;
}

export function Breadcrumbs({ items, showHome = true, className }: BreadcrumbsProps) {
	return (
		<nav aria-label="Breadcrumb" className={cn("flex items-center gap-1.5 text-sm", className)}>
			{showHome && (
				<>
					<Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
						<Home className="h-4 w-4" />
						<span className="sr-only">Home</span>
					</Link>
					{items.length > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
				</>
			)}
			{items.map((item, i) => {
				const isLast = i === items.length - 1;
				return (
					<span key={item.href ?? item.label} className="flex items-center gap-1.5">
						{isLast || !item.href ? (
							<span
								className={cn(isLast ? "font-medium text-foreground" : "text-muted-foreground")}
							>
								{item.label}
							</span>
						) : (
							<Link
								href={item.href}
								className="text-muted-foreground hover:text-foreground transition-colors"
							>
								{item.label}
							</Link>
						)}
						{!isLast && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
					</span>
				);
			})}
		</nav>
	);
}
