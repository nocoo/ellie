// components/forum/thread-badge.tsx — Thread badge display
// Ref: 04d §ThreadBadge — sticky/digest/closed/special labels

import { Badge } from "@/components/ui/badge";
import type { ThreadBadge } from "@ellie/types";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof Badge>["variant"]>;

/** Map model badge variant to shadcn Badge variant. */
function toBadgeVariant(variant: ThreadBadge["variant"]): BadgeVariant {
	switch (variant) {
		case "destructive":
			return "destructive";
		case "warning":
			return "outline";
		case "success":
			return "secondary";
		case "secondary":
			return "ghost";
		default:
			return "default";
	}
}

interface ThreadBadgeListProps {
	badges: ThreadBadge[];
}

export function ThreadBadgeList({ badges }: ThreadBadgeListProps) {
	if (badges.length === 0) return null;

	return (
		<span className="inline-flex items-center gap-1">
			{badges.map((badge) => (
				<Badge
					key={`${badge.type}-${badge.label}`}
					variant={toBadgeVariant(badge.variant)}
					className="text-[10px] px-1.5 py-0"
				>
					{badge.label}
				</Badge>
			))}
		</span>
	);
}
