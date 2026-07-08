/**
 * Write-permission checklist — pure model.
 *
 * Mirrors the runtime rules in apps/worker/src/lib/postingPermission.ts and
 * apps/worker/src/middleware/auth.ts::requireVerifiedEmail so admins can see,
 * per user, exactly which of the layered gates would reject a post/reply/DM
 * without having to preflight a real request.
 *
 * The checklist evaluates six layers in the same precedence the worker
 * enforces at write time; the first failing layer wins the "结论" line. Staff
 * (role >= 1) bypass L4/L5/L6 in the worker — we surface that as a distinct
 * status rather than fabricating passes.
 *
 * Kept as a pure function so unit tests can pin the exact code the UI shows
 * for every combination of user + settings.
 */

import type { User } from "./users";

/**
 * Site-level posting settings, keyed identically to the `settings` D1 rows.
 * Values are strings because that is how they are persisted. Every field is
 * required — the caller must apply defaults (see FEATURE_DEFAULTS) before
 * evaluation so the checklist never has to guess about missing keys.
 */
export interface WritePermissionSettings {
	/** `features.content.allow_new_thread` */
	allowNewThread: boolean;
	/** `features.content.allow_reply` */
	allowReply: boolean;
	/** `features.posting.enabled` — master switch for L5/L6 */
	postingRestrictionsEnabled: boolean;
	/** `features.posting.min_registration_days` (integer, ≥0) */
	minRegistrationDays: number;
	/** `features.posting.require_avatar` */
	requireAvatar: boolean;
}

/** Discrete outcomes a single checklist row can be in. */
export type CheckStatus = "pass" | "fail" | "skip" | "info";

/**
 * Categorises WHICH layer produced the fail so the UI can pick an icon /
 * link target and the "结论" line can name the layer. `staff-bypass` is
 * emitted on L4~L6 rows when the user is a moderator/admin: the worker
 * skips those checks (see postingPermission.ts::checkPostingPermission)
 * so we call it out rather than showing a spurious `pass`.
 */
export type CheckCode =
	| "STATUS_OK"
	| "STATUS_BANNED"
	| "STATUS_ARCHIVED"
	| "STATUS_TOMBSTONE"
	| "EMAIL_VERIFIED"
	| "EMAIL_NOT_VERIFIED"
	| "CONTENT_ALLOWED"
	| "CONTENT_DISABLED_BOTH"
	| "CONTENT_DISABLED_THREAD"
	| "CONTENT_DISABLED_REPLY"
	| "STAFF_BYPASS"
	| "POSTING_RESTRICTIONS_OFF"
	| "REG_DAYS_OK"
	| "REG_DAYS_TOO_SHORT"
	| "AVATAR_NOT_REQUIRED"
	| "AVATAR_PRESENT"
	| "AVATAR_MISSING";

export interface CheckItem {
	/** L2/L3/... — stable id for the UI + tests. */
	id: "L2" | "L3" | "L4" | "L5" | "L6";
	/** Chinese label for the row. */
	label: string;
	status: CheckStatus;
	code: CheckCode;
	/** One-line Chinese detail (may include numbers). */
	detail: string;
}

export interface WritePermissionResult {
	items: CheckItem[];
	/**
	 * true iff every non-skip item passed. Staff-bypass and info counts as
	 * pass for the "结论" line. Skip items (e.g. status<0 short-circuit) do
	 * NOT count against the total.
	 */
	canWrite: boolean;
	/**
	 * Ordered list of failing labels — the UI uses this to build the
	 * "被 X、Y 拦截" summary. Empty when canWrite is true.
	 */
	blockedBy: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute registration age in whole days using the same seconds-based math
 * the worker uses: floor((now - reg_date) / 86400). Callers pass `now` in
 * unix seconds so the calculation is deterministic in tests.
 */
export function registrationDays(regDate: number, nowSeconds: number): number {
	if (!regDate || regDate <= 0) return 0;
	const delta = nowSeconds - regDate;
	if (delta <= 0) return 0;
	return Math.floor(delta / 86400);
}

/**
 * Mirror of postingPermission.ts::checkPostingPermission's avatar rule:
 * hasAvatar = !!avatar_path || has_avatar === 1. Kept as its own helper
 * so the list-page badge (P2/P3) and the detail-page card share the
 * exact same predicate.
 */
export function userHasAvatar(user: Pick<User, "avatarPath" | "hasAvatar">): boolean {
	return Boolean(user.avatarPath) || user.hasAvatar === true;
}

// ─── Main evaluator ─────────────────────────────────────────────────────────

/**
 * Evaluate the six-layer write-permission checklist for a single user.
 *
 * Precedence rules that MUST match the worker:
 *   1. status !== 0 → L2 fails, L3~L6 are marked `skip` (worker never
 *      reaches those checks; showing pass/fail would mislead).
 *   2. Staff (role >= 1) → L4~L6 emit `STAFF_BYPASS` instead of running
 *      the actual settings-driven check, because the worker literally
 *      skips them (see postingPermission.ts §Check 2/3 guards).
 *   3. postingRestrictionsEnabled === false → L5/L6 emit
 *      `POSTING_RESTRICTIONS_OFF` regardless of settings underneath.
 */
export function evaluateWritePermission(
	user: User,
	settings: WritePermissionSettings,
	nowSeconds: number,
): WritePermissionResult {
	const l2 = evalStatus(user);
	if (user.status !== 0) {
		// Worker short-circuits at USER_BANNED — everything downstream is
		// unverified, so we mark it skip rather than fabricating pass/fail.
		return finalise([l2, ...statusSkipItems(user.status === -99)]);
	}
	const staff = user.role >= 1;
	return finalise([
		l2,
		evalEmail(user),
		evalContentSwitches(settings, staff),
		evalRegistrationDays(user, settings, staff, nowSeconds),
		evalAvatar(user, settings, staff),
	]);
}

function evalStatus(user: User): CheckItem {
	if (user.status === 0) {
		return { id: "L2", label: "账号状态", status: "pass", code: "STATUS_OK", detail: "正常" };
	}
	if (user.status === -1) {
		return {
			id: "L2",
			label: "账号状态",
			status: "fail",
			code: "STATUS_BANNED",
			detail: "已封禁",
		};
	}
	if (user.status === -99) {
		return {
			id: "L2",
			label: "账号状态",
			status: "fail",
			code: "STATUS_TOMBSTONE",
			detail: "已彻底清除",
		};
	}
	return {
		id: "L2",
		label: "账号状态",
		status: "fail",
		code: "STATUS_ARCHIVED",
		detail: `已归档 (status=${user.status})`,
	};
}

function statusSkipItems(tombstoned: boolean): CheckItem[] {
	const detail = tombstoned ? "账号已清除，后续检查跳过" : "账号非正常状态，后续检查跳过";
	return (["L3", "L4", "L5", "L6"] as const).map((id) => ({
		id,
		label: layerLabel(id),
		status: "skip" as const,
		code: statusSkipCode(id),
		detail,
	}));
}

function evalEmail(user: User): CheckItem {
	if ((user.emailVerifiedAt ?? 0) > 0) {
		return {
			id: "L3",
			label: "邮箱验证",
			status: "pass",
			code: "EMAIL_VERIFIED",
			detail: "已验证",
		};
	}
	return {
		id: "L3",
		label: "邮箱验证",
		status: "fail",
		code: "EMAIL_NOT_VERIFIED",
		detail: user.email ? `未验证 (${user.email})` : "未验证",
	};
}

function evalContentSwitches(settings: WritePermissionSettings, staff: boolean): CheckItem {
	if (staff) {
		return {
			id: "L4",
			label: "站点写开关",
			status: "info",
			code: "STAFF_BYPASS",
			detail: "员工用户，绕过站点写开关",
		};
	}
	const { allowNewThread, allowReply } = settings;
	if (allowNewThread && allowReply) {
		return {
			id: "L4",
			label: "站点写开关",
			status: "pass",
			code: "CONTENT_ALLOWED",
			detail: "发新主题 + 回复 均开启",
		};
	}
	if (!allowNewThread && !allowReply) {
		return {
			id: "L4",
			label: "站点写开关",
			status: "fail",
			code: "CONTENT_DISABLED_BOTH",
			detail: "发新主题 + 回复 均已关闭",
		};
	}
	if (!allowNewThread) {
		return {
			id: "L4",
			label: "站点写开关",
			status: "fail",
			code: "CONTENT_DISABLED_THREAD",
			detail: "发新主题 已关闭",
		};
	}
	return {
		id: "L4",
		label: "站点写开关",
		status: "fail",
		code: "CONTENT_DISABLED_REPLY",
		detail: "回复 已关闭",
	};
}

function evalRegistrationDays(
	user: User,
	settings: WritePermissionSettings,
	staff: boolean,
	nowSeconds: number,
): CheckItem {
	if (staff) {
		return {
			id: "L5",
			label: "注册天数",
			status: "info",
			code: "STAFF_BYPASS",
			detail: "员工用户，绕过注册天数门槛",
		};
	}
	if (!settings.postingRestrictionsEnabled) {
		return {
			id: "L5",
			label: "注册天数",
			status: "info",
			code: "POSTING_RESTRICTIONS_OFF",
			detail: "发帖门槛未启用",
		};
	}
	const days = registrationDays(user.regDate, nowSeconds);
	if (settings.minRegistrationDays <= 0 || days >= settings.minRegistrationDays) {
		return {
			id: "L5",
			label: "注册天数",
			status: "pass",
			code: "REG_DAYS_OK",
			detail: `${days} 天 ≥ ${settings.minRegistrationDays} 天`,
		};
	}
	return {
		id: "L5",
		label: "注册天数",
		status: "fail",
		code: "REG_DAYS_TOO_SHORT",
		detail: `${days} 天 < ${settings.minRegistrationDays} 天`,
	};
}

function evalAvatar(user: User, settings: WritePermissionSettings, staff: boolean): CheckItem {
	if (staff) {
		return {
			id: "L6",
			label: "头像",
			status: "info",
			code: "STAFF_BYPASS",
			detail: "员工用户，绕过头像门槛",
		};
	}
	if (!settings.postingRestrictionsEnabled) {
		return {
			id: "L6",
			label: "头像",
			status: "info",
			code: "POSTING_RESTRICTIONS_OFF",
			detail: "发帖门槛未启用",
		};
	}
	if (!settings.requireAvatar) {
		return {
			id: "L6",
			label: "头像",
			status: "pass",
			code: "AVATAR_NOT_REQUIRED",
			detail: "未强制要求头像",
		};
	}
	if (userHasAvatar(user)) {
		return {
			id: "L6",
			label: "头像",
			status: "pass",
			code: "AVATAR_PRESENT",
			detail: "已设置",
		};
	}
	return {
		id: "L6",
		label: "头像",
		status: "fail",
		code: "AVATAR_MISSING",
		detail: "未设置",
	};
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function layerLabel(id: "L3" | "L4" | "L5" | "L6"): string {
	switch (id) {
		case "L3":
			return "邮箱验证";
		case "L4":
			return "站点写开关";
		case "L5":
			return "注册天数";
		case "L6":
			return "头像";
	}
}

/**
 * When status short-circuits, all downstream items must ship with a code —
 * we reuse the "OFF/OK" variants so the UI can render a neutral message
 * without inventing new failure codes just for the skip case.
 */
function statusSkipCode(id: "L3" | "L4" | "L5" | "L6"): CheckCode {
	switch (id) {
		case "L3":
			return "EMAIL_NOT_VERIFIED";
		case "L4":
			return "CONTENT_ALLOWED";
		case "L5":
			return "POSTING_RESTRICTIONS_OFF";
		case "L6":
			return "POSTING_RESTRICTIONS_OFF";
	}
}

function finalise(items: CheckItem[]): WritePermissionResult {
	const failed = items.filter((it) => it.status === "fail");
	return {
		items,
		canWrite: failed.length === 0,
		blockedBy: failed.map((it) => it.label),
	};
}
