// components/forum/thread-badge.tsx — Thread badge display
// Ref: 04d §ThreadBadge — sticky/digest/closed/special badges

import { Badge } from "@/components/ui/badge";
import type { ThreadBadge as ThreadBadgeType } from "@/models/thread";

export interface ThreadBadgeProps {
	badge: ThreadBadgeType;
}

/**
 * Map ThreadBadge variant to shadcn Badge variant.
 * Pure function, exported for testing.
 */
export function mapBadgeVariant(
	variant: ThreadBadgeType["variant"],
): "default" | "secondary" | "destructive" | "outline" {
	switch (variant) {
		case "destructive":
			return "destructive";
		case "warning":
			return "outline";
		case "success":
			return "default";
		case "secondary":
			return "secondary";
		case "default":
			return "outline";
	}
}

export function ThreadBadge({ badge }: ThreadBadgeProps) {
	return (
		<Badge variant={mapBadgeVariant(badge.variant)} className="text-xs">
			{badge.label}
		</Badge>
	);
}
