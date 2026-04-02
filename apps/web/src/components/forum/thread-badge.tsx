// components/forum/thread-badge.tsx — Thread badge display
// Ref: 04d §ThreadBadge — sticky/digest/closed/special labels

import { Badge } from "@/components/ui/badge";
import type { ThreadBadge } from "@ellie/types";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof Badge>["variant"]>;

/**
 * Map model badge variant to shadcn Badge variant.
 *
 * Model variants → UI variants:
 * - destructive → destructive (red, global sticky)
 * - warning → warning (amber, category sticky / trade / bounty)
 * - success → success (green, digest)
 * - secondary → muted (gray, closed / typeName)
 * - default → default (primary blue, forum sticky / vote / activity / debate)
 */
function toBadgeVariant(variant: ThreadBadge["variant"]): BadgeVariant {
	switch (variant) {
		case "destructive":
			return "destructive";
		case "warning":
			return "warning";
		case "success":
			return "success";
		case "secondary":
			return "muted";
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
					className="text-2xs px-1 py-0 leading-tight"
				>
					{badge.label}
				</Badge>
			))}
		</span>
	);
}
