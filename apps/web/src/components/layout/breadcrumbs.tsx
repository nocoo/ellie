import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import { ChevronRight, Home } from "lucide-react";
import Link from "next/link";

export type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";

interface BreadcrumbsProps {
	items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
	return (
		<nav className="flex items-center gap-1 text-sm text-muted-foreground">
			{items.map((item, index) => (
				<span key={item.label} className="flex items-center gap-1">
					{index > 0 && <ChevronRight className="h-3 w-3" />}
					{item.href ? (
						<Link
							href={item.href}
							className="flex items-center gap-1 hover:text-foreground transition-colors"
						>
							{item.icon === "home" && <Home className="h-3.5 w-3.5" />}
							{item.label}
						</Link>
					) : (
						<span className="text-foreground font-medium">{item.label}</span>
					)}
				</span>
			))}
		</nav>
	);
}
