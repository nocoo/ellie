"use client";

// UserWriteGateBadges — compact write-permission summary for the admin
// users list. Shows one destructive badge per failing gate layer (未验证
// email / 无头像 / 新注册 / 已封禁 / 已归档 / 站点关闭) so operators can
// tell at a glance which users are silently blocked from posting without
// opening the detail dialog. Rows that pass every layer show a muted
// "✓ 可发布" pill so the column is never mysteriously empty.

import { Badge } from "@ellie/ui";
import { Check } from "lucide-react";
import { useMemo } from "react";
import type { User } from "@/viewmodels/admin/users";
import {
	evaluateWritePermission,
	type WritePermissionSettings,
} from "@/viewmodels/admin/write-permission";

export interface UserWriteGateBadgesProps {
	user: User;
	settings: WritePermissionSettings;
	/**
	 * Unix seconds. Shared across the whole page render so every row uses
	 * the same day boundary — otherwise a row rendered exactly at midnight
	 * could disagree with its sibling.
	 */
	nowSeconds: number;
}

/**
 * Compact Chinese label for each failure code. Kept next to the badge
 * component (not in write-permission.ts) because these strings target the
 * list-page density — they are shorter than the detail-page `label` field.
 */
const FAIL_LABEL: Record<string, string> = {
	STATUS_BANNED: "已封禁",
	STATUS_ARCHIVED: "已归档",
	STATUS_TOMBSTONE: "已清除",
	EMAIL_NOT_VERIFIED: "邮箱未验证",
	CONTENT_ALLOWED: "站点写关闭", // unreachable label, kept for exhaustiveness
	CONTENT_DISABLED_BOTH: "站点写关闭",
	CONTENT_DISABLED_THREAD: "禁止发主题",
	CONTENT_DISABLED_REPLY: "禁止回复",
	REG_DAYS_TOO_SHORT: "新注册",
	AVATAR_MISSING: "无头像",
};

export function UserWriteGateBadges({ user, settings, nowSeconds }: UserWriteGateBadgesProps) {
	const result = useMemo(
		() => evaluateWritePermission(user, settings, nowSeconds),
		[user, settings, nowSeconds],
	);

	if (result.canWrite) {
		// Green Badge (success variant) mirrors the red destructive Badge
		// used for failures below — same shape / weight so the column
		// reads as a symmetric pass/fail signal, not "loud red vs muted
		// gray afterthought".
		return (
			<Badge
				variant="success"
				className="text-xs font-normal"
				title="所有写权限门槛通过"
				data-testid="write-gate-pass"
			>
				<Check className="h-3 w-3" aria-hidden="true" />
				可发布
			</Badge>
		);
	}

	// Failing items only. `blockedBy` preserves the natural L2→L6 order,
	// but we render off `items` so we can carry the code + detail through.
	const fails = result.items.filter((it) => it.status === "fail");

	return (
		<div className="flex flex-wrap gap-1" data-testid="write-gate-fail-list">
			{fails.map((item) => (
				<Badge
					key={item.id}
					variant="destructive"
					className="text-xs font-normal"
					title={item.detail}
				>
					{FAIL_LABEL[item.code] ?? item.label}
				</Badge>
			))}
		</div>
	);
}
