"use client";

// UserDetailPanel — extracted from /admin/users/[id]/page.tsx as part
// of task #9 Phase B so the same body can be reused inside a dialog on
// the users list page (Phase C) without losing the standalone route.
//
// Two callers today:
//
//   1. Route fallback `/admin/users/[id]/page.tsx`:
//        <UserDetailPanel userId={...} />                 // defaults: showBack=true,
//                                                         //           onSearchIp=undefined,
//                                                         //           onChanged=undefined
//      Behaviour is byte-equivalent to the pre-extraction page —
//      BackLink renders, the "搜索同 IP 用户" button falls back to
//      `router.push("/admin/users?regIp=…" or "?lastIp=…")` because no
//      list page is mounted to intercept it; mutations only call
//      `reloadUser()` internally.
//
//   2. Dialog `UserDetailDialog` (Phase C):
//        <UserDetailPanel
//          userId={…}
//          showBack={false}
//          onSearchIp={(kind, ip) => { setListFilter(kind, ip); closeDialog(); }}
//          onChanged={({ kind }) => listActions.reloadCurrentPage()}
//        />
//      `onSearchIp` lets the list page intercept IP search before any
//      router.push escapes the dialog (which would otherwise drop
//      pagination/filter/selection — the whole point of the modal).
//      `onChanged` keeps the list table in sync after edit/ban/unban/purge
//      without forcing a full re-mount.
//
// Mutation flow (locked with reviewer msg=401c721d):
//   success → reloadUser()           // panel itself is always fresh
//           → onChanged?({ kind })   // outer list (if mounted) refreshes too
// `onChanged` is purely additive — route mode never sets it, so behaviour
// matches the original single-page version.

import { formatNumber } from "@ellie/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@ellie/ui";
import { ArrowLeft, Loader2, Pencil, Search, Shield, ShieldOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import { SegmentedSwitch } from "@/components/admin/segmented-switch";
import { UserAvatar } from "@/components/admin/user-avatar";
import { UserCheckinPanel } from "@/components/admin/user-checkin-panel";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { extractErrorMessage } from "@/lib/admin-error";
import { FIRST_POST_VARIANT, userRoleVariant, userStatusVariant } from "@/viewmodels/admin/badges";
import type { Thread } from "@/viewmodels/admin/threads";
import { type UserDetailPost, useUserDetail } from "@/viewmodels/admin/use-user-detail";
import {
	banUser,
	type PurgeResult,
	purgeUser,
	roleLabel,
	statusLabel,
	type User,
	type UserUpdate,
	unbanUser,
	updateUser,
} from "@/viewmodels/admin/users";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTimestamp(seconds: number | null | undefined): string {
	if (!seconds) return "—";
	return new Date(seconds * 1000).toLocaleString();
}

function fmtIp(ip: string | undefined): string {
	return ip && ip.trim().length > 0 ? ip : "—";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Discriminator for `onChanged` so callers can refresh only what they
 * care about (e.g. a row-status badge after `ban` / `unban`, or close
 * the dialog after `purge`).
 */
export type UserDetailChangeKind = "edit" | "ban" | "unban" | "purge";

export interface UserDetailPanelProps {
	userId: number;

	/**
	 * Render the top-left "返回用户列表" button. Defaults to `true` so the
	 * standalone route continues to expose a clear way back; the dialog
	 * caller passes `false` because the dialog's own close affordance
	 * already serves that role.
	 */
	showBack?: boolean;

	/**
	 * Handle "搜索同 IP 用户" intent from the panel. Wired by the
	 * `UserDetailDialog` wrapper so a click on the per-IP-row button
	 * updates the list page's filter state in-place and closes the
	 * dialog without leaving the route. When undefined (route fallback
	 * mode) the panel falls back to `router.push("/admin/users?regIp=…"
	 * or "?lastIp=…")`, with `URLSearchParams` to encode IPv6 colons.
	 */
	onSearchIp?: (kind: "regIp" | "lastIp", ip: string) => void;

	/**
	 * Notify the outer surface after a successful edit/ban/unban/purge.
	 * The panel ALWAYS calls `reloadUser()` itself first (so the panel's
	 * own data is fresh regardless of caller), then invokes `onChanged`
	 * for callers that need to refresh sibling state — e.g. the list
	 * page's row data so the status badge isn't stale after the dialog
	 * closes.
	 */
	onChanged?: (event: { kind: UserDetailChangeKind; userId: number }) => void;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function UserDetailPanel({
	userId,
	showBack = true,
	onSearchIp,
	onChanged,
}: UserDetailPanelProps) {
	const router = useRouter();

	const { state, actions } = useUserDetail({ userId });

	// "搜索同 IP 用户" handler — dialog mode calls `onSearchIp` so the
	// list page mutates its filter state in-place (Phase C). Route
	// fallback navigates to `/admin/users?<kind>=<ip>`; we go through
	// `URLSearchParams` so an IPv6 address's colons get encoded as `%3A`
	// instead of looking like a URL port.
	const handleSearchIp = (kind: "regIp" | "lastIp", ip: string | undefined | null) => {
		const trimmed = (ip ?? "").trim();
		if (!trimmed) return;
		if (onSearchIp) {
			onSearchIp(kind, trimmed);
			return;
		}
		const params = new URLSearchParams();
		params.set(kind, trimmed);
		router.push(`/admin/users?${params.toString()}`);
	};

	const [editOpen, setEditOpen] = useState(false);
	const [editLoading, setEditLoading] = useState(false);
	const [editError, setEditError] = useState<string | null>(null);
	// Controlled state for the threads/posts panel switch — mirrors the pattern
	// used on the KV monitor page so both screens use the same compact
	// SegmentedSwitch instead of the previous tall shadcn Tabs.
	const [activeContentTab, setActiveContentTab] = useState<"threads" | "posts">("threads");

	const [unbanLoading, setUnbanLoading] = useState(false);
	const [banDialogOpen, setBanDialogOpen] = useState(false);
	const [banLoading, setBanLoading] = useState(false);
	const [banError, setBanError] = useState<string | null>(null);

	// D4-d: typed-confirm purge dialog. Worker enforces all guards
	// (CONFIRM_MISMATCH / CANNOT_PURGE_STAFF / ALREADY_PURGED); UI just
	// surfaces the error in the dialog. Allow opening for staff so the
	// 403 path is reachable from this single source of truth.
	const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
	const [purgeLoading, setPurgeLoading] = useState(false);
	const [purgeError, setPurgeError] = useState<string | null>(null);

	const [pageMessage, setPageMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	// -----------------------------------------------------------------------
	// Mutation handlers
	// -----------------------------------------------------------------------

	const handleEditSave = async (id: number, update: UserUpdate) => {
		setEditLoading(true);
		setEditError(null);
		try {
			await updateUser(id, update);
			setEditOpen(false);
			await actions.reloadUser();
			onChanged?.({ kind: "edit", userId: id });
			setPageMessage({ type: "success", text: "已更新用户资料" });
		} catch (err) {
			setEditError(extractErrorMessage(err, "保存用户失败"));
		} finally {
			setEditLoading(false);
		}
	};

	const handleUnban = async (user: User) => {
		setUnbanLoading(true);
		setPageMessage(null);
		try {
			await unbanUser(user.id);
			await actions.reloadUser();
			onChanged?.({ kind: "unban", userId: user.id });
			setPageMessage({ type: "success", text: `已解除封禁 ${user.username}` });
		} catch (err) {
			setPageMessage({
				type: "error",
				text: extractErrorMessage(err, "解除封禁失败"),
			});
		} finally {
			setUnbanLoading(false);
		}
	};

	const handleBanConfirm = async (user: User) => {
		setBanLoading(true);
		setBanError(null);
		try {
			await banUser(user.id, false);
			setBanDialogOpen(false);
			await actions.reloadUser();
			onChanged?.({ kind: "ban", userId: user.id });
			setPageMessage({ type: "success", text: `已封禁 ${user.username}` });
		} catch (err) {
			setBanError(extractErrorMessage(err, "封禁用户失败"));
		} finally {
			setBanLoading(false);
		}
	};

	const handlePurgeConfirm = async (user: User) => {
		setPurgeLoading(true);
		setPurgeError(null);
		try {
			const result: PurgeResult = await purgeUser(user.id);
			setPurgeDialogOpen(false);
			// Reload moves the page to its tombstone view (status === -99 short
			// circuit). If the reload itself fails, keep the success banner
			// visible so the operator knows the purge succeeded.
			try {
				await actions.reloadUser();
			} catch {
				// swallow — the success message stays; operator can navigate back
			}
			onChanged?.({ kind: "purge", userId: user.id });
			const { deleted, r2 } = result;
			const detail = `主题 ${deleted.threads} · 帖子 ${deleted.posts} · 点评 ${deleted.comments} · 附件 ${deleted.attachments} · 私信 ${deleted.messages}${
				r2.failed.length > 0 ? ` · R2 失败 ${r2.failed.length}` : ""
			}`;
			setPageMessage({
				type: "success",
				text: `已彻底清除该用户（${detail}）`,
			});
		} catch (err) {
			setPurgeError(extractErrorMessage(err, "彻底清除失败"));
		} finally {
			setPurgeLoading(false);
		}
	};

	// -----------------------------------------------------------------------
	// Top-level loading / error
	// -----------------------------------------------------------------------

	if (Number.isNaN(userId)) {
		return (
			<div className="space-y-4">
				{showBack && <BackLinkButton onClick={() => router.push("/admin/users")} />}
				<AdminInlineMessage variant="error" text="无效的用户 ID" />
			</div>
		);
	}

	if (state.loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (state.error || !state.user) {
		return (
			<div className="space-y-4">
				{showBack && <BackLinkButton onClick={() => router.push("/admin/users")} />}
				<AdminInlineMessage variant="error" text={state.error ?? "用户不存在"} />
			</div>
		);
	}

	const user = state.user;

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	return (
		<div className="space-y-6 md:space-y-8">
			{showBack && <BackLinkButton onClick={() => router.push("/admin/users")} />}

			{/* Header */}
			<div className="flex items-center gap-4">
				<UserAvatar uid={user.id} username={user.username} avatarPath={user.avatarPath} size={48} />
				<div className="flex-1">
					<h1 className="text-2xl font-semibold text-foreground">{user.username}</h1>
					<div className="mt-1 flex items-center gap-2">
						<Badge variant={userStatusVariant(user.status)}>{statusLabel(user.status)}</Badge>
						<Badge variant={userRoleVariant(user.role)}>{roleLabel(user.role)}</Badge>
						<span className="text-sm text-muted-foreground">ID: {user.id}</span>
					</div>
				</div>
			</div>

			{pageMessage && <AdminInlineMessage variant={pageMessage.type} text={pageMessage.text} />}

			{/* Basic info + meta cards (two columns on lg) */}
			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>基本资料</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
							<dt className="text-muted-foreground">邮箱</dt>
							<dd className="break-all">{user.email || "—"}</dd>
							<dt className="text-muted-foreground">积分</dt>
							<dd>{formatNumber(user.credits)}</dd>
							<dt className="text-muted-foreground">主题数</dt>
							<dd>{formatNumber(user.threads)}</dd>
							<dt className="text-muted-foreground">帖子数</dt>
							<dd>{formatNumber(user.posts)}</dd>
							<dt className="text-muted-foreground">注册时间</dt>
							<dd>{fmtTimestamp(user.regDate)}</dd>
							<dt className="text-muted-foreground">最后登录</dt>
							<dd>{fmtTimestamp(user.lastLogin)}</dd>
						</dl>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>元信息</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* 登录 IP — persistent users.reg_ip / users.last_ip.
						    The 搜索同 IP 用户 button only renders when the
						    matching IP is non-empty so empty cells never
						    produce a navigation that would land on an empty
						    list. Dialog mode goes through `onSearchIp` (no
						    navigation, dialog closes itself); route mode
						    falls back to `router.push` with URL-encoded
						    params so IPv6 colons survive. */}
						<dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
							<dt className="text-muted-foreground">注册 IP</dt>
							<dd>
								<span className="font-mono">{fmtIp(user.regIp)}</span>
								<IpLookupInline ip={user.regIp} />
								{user.regIp && user.regIp.trim().length > 0 && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="ml-2 h-7 px-2 text-xs"
										onClick={() => handleSearchIp("regIp", user.regIp)}
									>
										<Search className="mr-1 h-3 w-3" />
										搜索同 IP 用户
									</Button>
								)}
							</dd>
							<dt className="text-muted-foreground">上次登录 IP</dt>
							<dd>
								<span className="font-mono">{fmtIp(user.lastIp)}</span>
								<IpLookupInline ip={user.lastIp} />
								{user.lastIp && user.lastIp.trim().length > 0 && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="ml-2 h-7 px-2 text-xs"
										onClick={() => handleSearchIp("lastIp", user.lastIp)}
									>
										<Search className="mr-1 h-3 w-3" />
										搜索同 IP 用户
									</Button>
								)}
							</dd>
						</dl>

						{/* G.5: current online soft signal — only shown when worker
						    attached a fresh `online:<uid>` KV snapshot (TTL ≤15min).
						    Whole block hides when the user is not currently online. */}
						{user.onlineIp && user.onlineIp.trim().length > 0 && (
							<div className="border-t pt-3">
								<div className="mb-2 text-xs text-muted-foreground">
									当前在线 · 软指标 · TTL 15min
								</div>
								<dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
									<dt className="text-muted-foreground">当前在线 IP</dt>
									<dd>
										<span className="font-mono">{fmtIp(user.onlineIp)}</span>
										<IpLookupInline ip={user.onlineIp} />
									</dd>
									{user.onlinePage && (
										<>
											<dt className="text-muted-foreground">当前页面</dt>
											<dd className="break-all font-mono">{user.onlinePage}</dd>
										</>
									)}
									{user.onlineTs && user.onlineTs > 0 && (
										<>
											<dt className="text-muted-foreground">心跳时间</dt>
											<dd>{fmtTimestamp(user.onlineTs)}</dd>
										</>
									)}
								</dl>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Threads + Posts tabs */}
			<Card>
				<CardHeader>
					<CardTitle>用户内容</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						<SegmentedSwitch
							ariaLabel="切换用户内容视图"
							value={activeContentTab}
							onValueChange={setActiveContentTab}
							options={[
								{
									value: "threads",
									label: `主题（${formatNumber(user.threads)}）`,
								},
								{
									value: "posts",
									label: `帖子（${formatNumber(user.posts)}）`,
								},
							]}
						/>

						{activeContentTab === "threads" && (
							<div role="tabpanel" aria-label="用户主题列表" className="space-y-2">
								{state.threadsError && (
									<AdminInlineMessage variant="error" text={state.threadsError} />
								)}
								<AdminDataTable<Thread>
									columns={threadColumns}
									data={state.threads}
									getRowId={(t) => t.id}
									loading={state.threadsLoading}
									emptyMessage="此用户没有主题"
								/>
								<AdminPagination
									pagination={state.threadsPagination}
									onPageChange={actions.setThreadsPage}
								/>
							</div>
						)}

						{activeContentTab === "posts" && (
							<div role="tabpanel" aria-label="用户帖子列表" className="space-y-2">
								{state.postsError && <AdminInlineMessage variant="error" text={state.postsError} />}
								<AdminDataTable<UserDetailPost>
									columns={postColumns}
									data={state.posts}
									getRowId={(p) => p.id}
									loading={state.postsLoading}
									emptyMessage="此用户没有帖子"
								/>
								<AdminPagination
									pagination={state.postsPagination}
									onPageChange={actions.setPostsPage}
								/>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Check-in panel (Phase F) — only meaningful for non-tombstoned users */}
			{user.status !== -99 && <UserCheckinPanel userId={user.id} />}

			{/* Danger zone */}
			<Card>
				<CardHeader>
					<CardTitle>操作</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						{user.status === -99 ? (
							<p className="text-sm text-muted-foreground">
								此用户已被彻底清除，无法再编辑或封禁。
							</p>
						) : (
							<>
								<Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
									<Pencil className="mr-1 h-4 w-4" />
									编辑资料
								</Button>
								{user.status !== -1 && (
									<Button
										variant="destructive"
										size="sm"
										onClick={() => {
											setBanError(null);
											setBanDialogOpen(true);
										}}
									>
										<Shield className="mr-1 h-4 w-4" />
										封禁用户
									</Button>
								)}
								{user.status === -1 && (
									<Button
										variant="outline"
										size="sm"
										onClick={() => handleUnban(user)}
										disabled={unbanLoading}
									>
										<ShieldOff className="mr-1 h-4 w-4" />
										{unbanLoading ? "解除中..." : "解除封禁"}
									</Button>
								)}
								<Button
									variant="destructive"
									size="sm"
									onClick={() => {
										setPurgeError(null);
										setPurgeDialogOpen(true);
									}}
									data-testid="purge-user-button"
								>
									<Trash2 className="mr-1 h-4 w-4" />
									彻底清除
								</Button>
							</>
						)}
					</div>
				</CardContent>
			</Card>

			<UserEditDialog
				open={editOpen}
				onOpenChange={(open) => {
					setEditOpen(open);
					if (!open) setEditError(null);
				}}
				user={user}
				loading={editLoading}
				error={editError}
				onSave={handleEditSave}
			/>

			<AdminConfirmDialog
				open={banDialogOpen}
				onOpenChange={(open) => {
					setBanDialogOpen(open);
					if (!open) setBanError(null);
				}}
				title="封禁用户"
				description={`确定封禁 ${user.username}？封禁后该用户将无法访问论坛。`}
				variant="destructive"
				loading={banLoading}
				error={banError}
				onConfirm={() => handleBanConfirm(user)}
			/>

			<AdminConfirmDialog
				open={purgeDialogOpen}
				onOpenChange={(open) => {
					setPurgeDialogOpen(open);
					if (!open) setPurgeError(null);
				}}
				title="彻底清除用户"
				description={`将永久删除 ${user.username} 的全部主题、帖子、点评、附件、私信，并清空 R2 文件并写入 tombstone。此操作不可逆，无法恢复。`}
				requireInput="ok"
				inputPlaceholder="输入 ok 以确认"
				variant="destructive"
				confirmLabel="彻底清除"
				loading={purgeLoading}
				error={purgeError}
				onConfirm={() => handlePurgeConfirm(user)}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function BackLinkButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft className="h-4 w-4" />
			返回用户列表
		</button>
	);
}

// ---------------------------------------------------------------------------
// Column definitions (extracted so the JSX above stays readable)
// ---------------------------------------------------------------------------

const threadColumns: ColumnDef<Thread>[] = [
	{
		key: "subject",
		header: "标题",
		cell: (t) => (
			<Link href={`/admin/threads/${t.id}`} className="font-medium hover:underline">
				{t.subject}
			</Link>
		),
	},
	{
		key: "replies",
		header: "回复",
		cell: (t) => formatNumber(t.replies),
		className: "text-right",
	},
	{
		key: "views",
		header: "浏览",
		cell: (t) => formatNumber(t.views),
		className: "text-right",
	},
	{
		key: "lastPost",
		header: "最后回复",
		cell: (t) => fmtTimestamp(t.lastPostAt),
	},
];

const postColumns: ColumnDef<UserDetailPost>[] = [
	{
		key: "thread",
		header: "所在主题",
		cell: (p) => (
			<Link
				href={`/admin/threads/${p.threadId}`}
				className="hover:underline"
				title={p.threadSubject ?? `#${p.threadId}`}
			>
				{p.threadSubject ?? `#${p.threadId}`}
			</Link>
		),
	},
	{
		key: "content",
		header: "内容",
		cell: (p) => <span className="line-clamp-2 text-sm">{p.content}</span>,
	},
	{
		key: "isFirst",
		header: "首楼",
		cell: (p) => (p.isFirst ? <Badge variant={FIRST_POST_VARIANT}>是</Badge> : "—"),
	},
	{
		key: "createdAt",
		header: "时间",
		cell: (p) => fmtTimestamp(p.createdAt),
	},
];
