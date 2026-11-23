// components/forum/thread-badge.tsx — Thread badge display
// Ref: 04d §ThreadBadge — sticky/digest/closed/special labels

import type { ThreadBadge } from "@ellie/types";
import { Badge } from "@nocoo/basalt/components/badge";
import type { ComponentProps } from "react";
import { DigestIcon } from "./digest-icon";

type BadgeTone = NonNullable<ComponentProps<typeof Badge>["tone"]>;

function toBadgeTone(variant: ThreadBadge["variant"]): BadgeTone {
	switch (variant) {
		case "destructive":
			return "danger";
		case "warning":
			return "warning";
		case "success":
			return "success";
		case "secondary":
			return "neutral";
		default:
			return "info";
	}
}

interface ThreadBadgeListProps {
	badges: ThreadBadge[];
	digestLevel: number;
}

export function ThreadBadgeList({ badges, digestLevel }: ThreadBadgeListProps) {
	if (badges.length === 0) return null;

	return (
		<span className="inline-flex items-center gap-1">
			{badges.map((badge) =>
				badge.type === "digest" ? (
					<DigestIcon key="digest" level={digestLevel} />
				) : (
					<Badge
						key={`${badge.type}-${badge.label}`}
						tone={toBadgeTone(badge.variant)}
						className="text-xs px-1 py-0 leading-tight"
						data-testid="thread-badge"
					>
						{badge.label}
					</Badge>
				),
			)}
		</span>
	);
}
