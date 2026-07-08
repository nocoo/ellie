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
import { useEffect, useMemo, useState } from "react";
import { FEATURE_DEFAULTS, fetchFeatureSettings } from "@/viewmodels/admin/features";
import type { User } from "@/viewmodels/admin/users";
import {
	type CheckItem,
	type CheckStatus,
	evaluateWritePermission,
	type WritePermissionSettings,
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

/**
 * Best-effort load of the five posting/content settings from the same
 * `/api/admin/settings?prefix=features.` endpoint the feature-settings form
 * uses. Missing keys fall through to FEATURE_DEFAULTS so a fresh install (or
 * a fetch failure) still renders a plausible checklist rather than blocking
 * the whole card.
 */
function useWritePermissionSettings(): {
	settings: WritePermissionSettings;
	loading: boolean;
	error: string | null;
} {
	const [state, setState] = useState<{
		settings: WritePermissionSettings;
		loading: boolean;
		error: string | null;
	}>(() => ({
		settings: settingsFromMap({}),
		loading: true,
		error: null,
	}));

	useEffect(() => {
		let cancelled = false;
		fetchFeatureSettings()
			.then((res) => {
				if (cancelled) return;
				const flat: Record<string, string> = {};
				for (const [k, v] of Object.entries(res)) flat[k] = v.value;
				setState({ settings: settingsFromMap(flat), loading: false, error: null });
			})
			.catch((err) => {
				if (cancelled) return;
				// Silent fallback — the checklist still renders using defaults so
				// operators are never blocked. Surfacing the error as a small
				// hint keeps them aware if the values might be stale.
				setState({
					settings: settingsFromMap({}),
					loading: false,
					error: err instanceof Error ? err.message : "settings 读取失败，使用默认值",
				});
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return state;
}

/**
 * Project the raw settings map into the shape evaluateWritePermission wants,
 * applying FEATURE_DEFAULTS as fallbacks. Extracted so both the runtime
 * fetch path and any future SSR/hard-coded caller share one converter.
 */
function settingsFromMap(map: Record<string, string>): WritePermissionSettings {
	const resolve = (key: string): string => map[key] ?? FEATURE_DEFAULTS[key] ?? "";
	return {
		allowNewThread: resolve("features.content.allow_new_thread") !== "false",
		allowReply: resolve("features.content.allow_reply") !== "false",
		postingRestrictionsEnabled: resolve("features.posting.enabled") === "true",
		minRegistrationDays: Number.parseInt(resolve("features.posting.min_registration_days"), 10),
		requireAvatar: resolve("features.posting.require_avatar") === "true",
	};
}

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
		<Card>
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
						<p
							className={
								result.canWrite
									? "border-t pt-3 text-sm text-green-700 dark:text-green-400"
									: "border-t pt-3 text-sm text-destructive"
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
			className="grid grid-cols-[1.25rem_5rem_1fr] items-baseline gap-2"
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
