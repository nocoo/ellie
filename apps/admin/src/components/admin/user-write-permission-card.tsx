"use client";

// UserWritePermissionCard — read-only checklist mirroring the six-layer write
// gate the worker enforces (see viewmodels/admin/write-permission.ts). Shown
// on the admin user-detail page so operators can tell at a glance which layer
// would reject this user's write attempt, without preflighting a real request.
//
// The card owns its own settings fetch (single call to
// /api/admin/settings?prefix=features.) because the panel is mounted both as
// a route and inside a dialog; wiring the settings through the panel props
// would duplicate the fetch on every mount. Failure to load settings falls
// back to FEATURE_DEFAULTS so the card never blocks the detail view.

import { Card, CardContent, CardHeader, CardTitle } from "@ellie/ui";
import { AlertCircle, Check, Info, X } from "lucide-react";
import { useMemo } from "react";
import { useWritePermissionSettings } from "@/viewmodels/admin/use-write-permission-settings";
import type { User } from "@/viewmodels/admin/users";
import {
	type CheckItem,
	type CheckStatus,
	evaluateWritePermission,
} from "@/viewmodels/admin/write-permission";

export interface UserWritePermissionCardProps {
	user: User;
}

/**
 * Icon for each row status.
 *  pass  ✓ green
 *  fail  ✗ red
 *  skip  · muted (skipped because a prior layer short-circuited)
 *  info  i blue (staff bypass / master switch off)
 */
const STATUS_ICON: Record<CheckStatus, typeof Check> = {
	pass: Check,
	fail: X,
	skip: Info,
	info: Info,
};

const STATUS_ICON_CLASS: Record<CheckStatus, string> = {
	pass: "text-green-600 dark:text-green-400",
	fail: "text-destructive",
	skip: "text-muted-foreground",
	info: "text-blue-600 dark:text-blue-400",
};

export function UserWritePermissionCard({ user }: UserWritePermissionCardProps) {
	const { settings, loading, error } = useWritePermissionSettings();
	// Snapshot "now" once per render so repeated re-renders during a single
	// pass see the same day boundary; the value refreshes every mount, which
	// is granular enough for the seconds-level worker rule.
	const nowSeconds = Math.floor(Date.now() / 1000);

	const result = useMemo(
		() => evaluateWritePermission(user, settings, nowSeconds),
		[user, settings, nowSeconds],
	);

	// Conclusion text driven by the same result — never invented independently.
	const conclusion = useMemo(() => {
		if (result.canWrite) return "此用户可以正常发布内容。";
		return `被【${result.blockedBy.join("】+【")}】拦截，当前无法发布任何内容。`;
	}, [result]);

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>写权限体检</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{loading ? (
					<p className="text-sm text-muted-foreground">正在读取站点设置…</p>
				) : (
					<>
						{error && (
							<p className="flex items-start gap-2 text-xs text-muted-foreground">
								<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
								<span>{error}（使用默认设置继续渲染）</span>
							</p>
						)}
						<ul className="space-y-1.5 text-sm" data-testid="write-permission-checklist">
							{result.items.map((item) => (
								<ChecklistRow key={item.id} item={item} />
							))}
						</ul>
						{/*
						 * Conclusion sits just under the checklist without a
						 * border-t. Divider policy (哥 2026-07-09): only the
						 * boundary between top-level modules gets a rule; a
						 * card's internals stay clean.
						 */}
						<p
							className={
								result.canWrite
									? "text-sm text-green-700 dark:text-green-400"
									: "text-sm text-destructive"
							}
							data-testid="write-permission-conclusion"
						>
							{conclusion}
						</p>
					</>
				)}
			</CardContent>
		</Card>
	);
}

function ChecklistRow({ item }: { item: CheckItem }) {
	const Icon = STATUS_ICON[item.status];
	return (
		<li
			className="grid grid-cols-[1.25rem_4rem_1fr] items-baseline gap-2"
			data-item-id={item.id}
			data-item-status={item.status}
		>
			<span className={STATUS_ICON_CLASS[item.status]} aria-hidden="true">
				<Icon className="h-4 w-4" />
			</span>
			<span className="text-muted-foreground">{item.label}</span>
			<span className="break-all">{item.detail}</span>
		</li>
	);
}
