"use client";

// user-columns — shared admin table column preset for `User` rows.
//
// Consumed by:
//   - /admin/users/page.tsx (variant: "full") — the main user management
//     surface. Passes onOpenDetail so the user cell opens the detail
//     dialog; passes writeGateSettings+nowSeconds so the 写权限 column
//     renders.
//   - /admin/recent/page.tsx UsersTab (variant: "compact") — the incremental
//     view. Omits writeGate opts entirely; the user cell falls back to a
//     plain <Link> to /admin/users/{id}.
//
// Extraction contract (哥 2026-07-09 review):
//   - Column *presence* differs between variants; column *rendering* logic
//     lives in exactly one place so a future change to any cell propagates
//     to both surfaces automatically.
//   - The "actions" column is NOT emitted here — dialog wiring differs
//     enough per caller that pages splice their own tail column after
//     calling buildUserColumns.

import { formatNumber } from "@ellie/shared";
import { Badge } from "@ellie/ui";
import Link from "next/link";
import type { ColumnDef } from "@/components/admin/admin-data-table";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import { UserAvatar } from "@/components/admin/user-avatar";
import { UserWriteGateBadges } from "@/components/admin/user-write-gate-badges";
import { userRoleVariant, userStatusVariant } from "@/viewmodels/admin/badges";
import { roleLabel, statusLabel, type User } from "@/viewmodels/admin/users";
import type { WritePermissionSettings } from "@/viewmodels/admin/write-permission";

export type UserColumnVariant = "full" | "compact";

export interface BuildUserColumnsOpts {
	variant: UserColumnVariant;
	/**
	 * When provided, the user cell renders a <button> that triggers this
	 * callback (opening a detail dialog); when omitted, the cell falls back
	 * to a plain <Link href="/admin/users/{id}"> — the pre-v1.7 behaviour of
	 * /admin/recent's UsersTab.
	 */
	onOpenDetail?: (userId: number) => void;
	/**
	 * Both writeGateSettings AND nowSeconds must be provided to render the
	 * 写权限 column; when either is missing the column is dropped defensively.
	 * The full variant relies on the main users page calling
	 * useWritePermissionSettings — the compact variant intentionally does
	 * not, so a page that wants writeGate must opt in explicitly.
	 */
	writeGateSettings?: WritePermissionSettings;
	nowSeconds?: number;
}

/**
 * Build the shared `ColumnDef<User>[]` for admin user tables.
 *
 * Full variant column keys:
 *   user, email, role, status, writeGate?, threads, posts,
 *   messages, attachments, registered
 * Compact variant column keys:
 *   user, email, role, registered, regIp
 *
 * The `email` column renders a destructive `未验证` badge next to the
 * address on `status === 0 && !emailVerifiedAt` rows in BOTH variants —
 * this deliberately backfills the badge to /admin/recent (previous
 * behaviour: only /admin/users had it).
 */
export function buildUserColumns(opts: BuildUserColumnsOpts): ColumnDef<User>[] {
	const { variant, onOpenDetail, writeGateSettings, nowSeconds } = opts;

	const userCell: ColumnDef<User> = {
		key: "user",
		header: "用户",
		cell: (row) => {
			const inner = (
				<>
					<UserAvatar uid={row.id} username={row.username} avatarPath={row.avatarPath} size={32} />
					<span className="font-medium">{row.username}</span>
				</>
			);
			if (onOpenDetail) {
				return (
					<button
						type="button"
						onClick={() => onOpenDetail(row.id)}
						className="flex items-center gap-2 text-foreground hover:underline"
					>
						{inner}
					</button>
				);
			}
			return (
				<Link
					href={`/admin/users/${row.id}`}
					className="flex items-center gap-2 text-foreground hover:underline"
				>
					{inner}
				</Link>
			);
		},
	};

	const emailCell: ColumnDef<User> = {
		key: "email",
		header: "邮箱",
		cell: (row) => (
			<div className="flex flex-wrap items-center gap-1.5">
				<span className="break-all">{row.email || "—"}</span>
				{row.status === 0 && !row.emailVerifiedAt && <Badge variant="destructive">未验证</Badge>}
			</div>
		),
	};

	const roleCell: ColumnDef<User> = {
		key: "role",
		header: "角色",
		cell: (row) => <Badge variant={userRoleVariant(row.role)}>{roleLabel(row.role)}</Badge>,
	};

	const statusCell: ColumnDef<User> = {
		key: "status",
		header: "状态",
		cell: (row) => <Badge variant={userStatusVariant(row.status)}>{statusLabel(row.status)}</Badge>,
	};

	const writeGateCell: ColumnDef<User> | null =
		writeGateSettings && nowSeconds !== undefined
			? {
					key: "writeGate",
					header: "写权限",
					cell: (row) => (
						<UserWriteGateBadges user={row} settings={writeGateSettings} nowSeconds={nowSeconds} />
					),
				}
			: null;

	const threadsCell: ColumnDef<User> = {
		key: "threads",
		header: "主题",
		// `?? 0` mirrors the defensive fallback in thread-columns —
		// sparse payloads from list endpoints (e.g. incremental views
		// that don't join counters) would otherwise crash formatNumber.
		cell: (row) => formatNumber(row.threads ?? 0),
		className: "text-right tabular-nums",
	};

	const postsCell: ColumnDef<User> = {
		key: "posts",
		header: "帖子",
		cell: (row) => formatNumber(row.posts ?? 0),
		className: "text-right tabular-nums",
	};

	const messagesCell: ColumnDef<User> = {
		key: "messages",
		header: "站内信",
		// `messagesCount` is admin-list-only enrichment from `enrichListRows`
		// (worker handlers/admin/user.ts). Worker always emits a number on
		// the list path; the `?? 0` is belt-and-braces.
		cell: (row) => formatNumber(row.messagesCount ?? 0),
		className: "text-right tabular-nums",
	};

	const attachmentsCell: ColumnDef<User> = {
		key: "attachments",
		header: "附件",
		cell: (row) => formatNumber(row.attachmentsCount ?? 0),
		className: "text-right tabular-nums",
	};

	const registeredCell: ColumnDef<User> = {
		key: "registered",
		header: "注册时间",
		cell: (row) => new Date(row.regDate * 1000).toLocaleDateString(),
	};

	const regIpCell: ColumnDef<User> = {
		key: "regIp",
		header: "注册 IP",
		cell: (row) => (
			<div className="flex items-center gap-1">
				<span className="font-mono text-sm">{row.regIp || "—"}</span>
				{row.regIp && <IpLookupInline ip={row.regIp} />}
			</div>
		),
	};

	if (variant === "full") {
		return [
			userCell,
			emailCell,
			roleCell,
			statusCell,
			...(writeGateCell ? [writeGateCell] : []),
			threadsCell,
			postsCell,
			messagesCell,
			attachmentsCell,
			registeredCell,
		];
	}
	// compact
	return [userCell, emailCell, roleCell, registeredCell, regIpCell];
}
