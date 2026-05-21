"use client";

// Admin User Detail Page (View layer)
// MVVM: ViewModel is `useUserDetail`. Mutation handlers (edit/ban/unban)
// are inlined here because they only run from this single page; no
// shared dialog state is needed beyond UserEditDialog + AdminConfirmDialog.
//
// Scope (D2): basic info card, meta card (reg_ip / last_ip), threads /
// posts tabs with pagination, danger zone with 编辑 + 封禁 (when not
// banned) + 解除封禁 (when banned). 封禁 here is the plain ban path
// (banUser(id, false)) — content-deletion / tombstone purge land in D4.

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
	type PurgeResult,
	type User,
	type UserUpdate,
	banUser,
	purgeUser,
	roleLabel,
	statusLabel,
	unbanUser,
	updateUser,
} from "@/viewmodels/admin/users";
import { formatNumber } from "@ellie/shared";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@ellie/ui";
import { ArrowLeft, Loader2, Pencil, Shield, ShieldOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

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
// Page
// ---------------------------------------------------------------------------

export default function UserDetailPage() {
	const params = useParams();
	const router = useRouter();
	const userId = Number(params.id);

	const { state, actions } = useUserDetail({ userId });

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
				<BackLink />
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
				<BackLink />
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
			<BackLink />

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
						{/* 登录 IP — persistent users.reg_ip / users.last_ip */}
						<dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
							<dt className="text-muted-foreground">注册 IP</dt>
							<dd>
								<span className="font-mono">{fmtIp(user.regIp)}</span>
								<IpLookupInline ip={user.regIp} />
							</dd>
							<dt className="text-muted-foreground">上次登录 IP</dt>
							<dd>
								<span className="font-mono">{fmtIp(user.lastIp)}</span>
								<IpLookupInline ip={user.lastIp} />
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

	function BackLink() {
		return (
			<button
				type="button"
				onClick={() => router.push("/admin/users")}
				className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				返回用户列表
			</button>
		);
	}
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
