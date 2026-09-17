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
//   success → reloadUser() for reversible changes; a confirmed receipt for purge
//           → onChanged?({ kind })   // outer list (if mounted) refreshes too
// `onChanged` is purely additive — route mode never sets it, so behaviour
// matches the original single-page version.

import { formatNumber } from "@ellie/shared";
import { contentToText } from "@ellie/shared/content";
import {
	Badge,
	Button,
	DescriptionList,
	LayerCard,
	Separator,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nocoo/basalt";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	ArrowLeft,
	CircleCheck,
	Coins,
	Files,
	Globe,
	MessageSquare,
	Pencil,
	Search,
	Shield,
	ShieldOff,
	Trash2,
	Trophy,
	UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import { UserAvatar } from "@/components/admin/user-avatar";
import { UserCheckinPanel } from "@/components/admin/user-checkin-panel";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { UserWritePermissionCard } from "@/components/admin/user-write-permission-card";
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

function PurgeCompletion({ result, onBack }: { result: PurgeResult; onBack?: () => void }) {
	return (
		<div className="space-y-4">
			{onBack && <BackLinkButton onClick={onBack} />}
			<PageHeader title="用户已清除" description={`ID: ${result.id} · 已停用账号并清除用户内容`} />
			<AdminInlineMessage
				variant="success"
				text={
					result.alreadyPurged
						? "已确认该用户已清除，无需再次操作。"
						: `已彻底清除该用户（主题 ${result.deleted.threads} · 帖子 ${result.deleted.posts} · 点评 ${result.deleted.comments} · 附件 ${result.deleted.attachments} · 私信 ${result.deleted.messages}）`
				}
			/>
			{!result.alreadyPurged && result.r2.failed.length > 0 && (
				<AdminInlineMessage
					variant="info"
					text={`账号和内容已清除，${result.r2.failed.length} 个存储文件的清理尚未确认。`}
				/>
			)}
			<LayerCard padding="sm">
				<div className="flex items-center gap-3 text-sm text-basalt-muted-foreground">
					<CircleCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-basalt-primary" />
					清除结果已确认，账号无法继续登录、发帖或发送私信。
				</div>
			</LayerCard>
		</div>
	);
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
	 * Reversible changes reload the user; purge renders its confirmed receipt.
	 * The panel then invokes `onChanged`
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
	const [activeContentTab, setActiveContentTab] = useState<"threads" | "posts">("threads");

	const [unbanLoading, setUnbanLoading] = useState(false);
	const [banDialogOpen, setBanDialogOpen] = useState(false);
	const [banLoading, setBanLoading] = useState(false);
	const [banError, setBanError] = useState<string | null>(null);

	// D4-d: typed-confirm purge dialog. Worker enforces all guards
	// (CONFIRM_MISMATCH / CANNOT_PURGE_STAFF); UI just
	// surfaces the error in the dialog. Allow opening for staff so the
	// 403 path is reachable from this single source of truth.
	const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
	const [purgeLoading, setPurgeLoading] = useState(false);
	const [purgeError, setPurgeError] = useState<string | null>(null);
	const [purgeReceipt, setPurgeReceipt] = useState<PurgeResult | null>(null);

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
		let result: PurgeResult;
		try {
			result = await purgeUser(user.id);
		} catch (err) {
			setPurgeError(extractErrorMessage(err, "彻底清除失败"));
			return;
		} finally {
			setPurgeLoading(false);
		}
		setPurgeDialogOpen(false);
		setPurgeReceipt(result);
		onChanged?.({ kind: "purge", userId: user.id });
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

	if (purgeReceipt?.id === userId) {
		return (
			<PurgeCompletion
				result={purgeReceipt}
				onBack={showBack ? () => router.push("/admin/users") : undefined}
			/>
		);
	}

	if (state.loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader className="h-6 w-6 text-basalt-muted-foreground" />
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
	const tombstoned = user.status === -99;

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	return (
		<div className="space-y-4">
			{showBack && <BackLinkButton onClick={() => router.push("/admin/users")} />}

			<PageHeader
				title={
					<span className="flex min-w-0 items-center gap-3">
						<UserAvatar
							uid={user.id}
							username={user.username}
							avatarPath={user.avatarPath}
							size={48}
						/>
						<span className="min-w-0 break-all">{user.username}</span>
					</span>
				}
				description={
					<span className="flex flex-wrap items-center gap-2">
						<Badge variant={userStatusVariant(user.status)}>{statusLabel(user.status)}</Badge>
						<Badge variant={userRoleVariant(user.role)}>{roleLabel(user.role)}</Badge>
						<span>ID: {user.id}</span>
					</span>
				}
				actions={
					<UserActionButtons
						user={user}
						unbanLoading={unbanLoading}
						onEdit={() => setEditOpen(true)}
						onOpenBan={() => {
							setBanError(null);
							setBanDialogOpen(true);
						}}
						onUnban={() => handleUnban(user)}
						onOpenPurge={() => {
							setPurgeError(null);
							setPurgeDialogOpen(true);
						}}
					/>
				}
			/>

			{pageMessage && <AdminInlineMessage variant={pageMessage.type} text={pageMessage.text} />}

			<AdminMetrics
				label="用户数据概览"
				items={[
					{
						label: "主题",
						value: user.threads,
						icon: Files,
						hint:
							user.digestPosts == null
								? undefined
								: `其中 ${formatNumber(user.digestPosts)} 个精华主题`,
					},
					{ label: "帖子（含首帖）", value: user.posts, icon: MessageSquare, hint: "账号内容计数" },
					{ label: "积分", value: user.credits, icon: Trophy },
					{ label: "金币", value: user.coins, icon: Coins },
				]}
			/>

			<div className={`grid gap-4 md:grid-cols-2 ${tombstoned ? "" : "xl:grid-cols-3"}`}>
				<LayerCard padding="sm">
					<LayerCard.Header>
						<h2 className="flex items-center gap-2 text-sm font-medium">
							<UserRound aria-hidden="true" className="h-4 w-4 text-basalt-primary" />
							基本资料
						</h2>
					</LayerCard.Header>
					<LayerCard.Well className="flex-1">
						<DescriptionList columns={1}>
							<DescriptionList.Item term="邮箱">
								<div className="break-all">{user.email || "—"}</div>
							</DescriptionList.Item>
							<DescriptionList.Item term="注册时间">
								{fmtTimestamp(user.regDate)}
							</DescriptionList.Item>
							<DescriptionList.Item term="最后登录">
								{fmtTimestamp(user.lastLogin)}
							</DescriptionList.Item>
						</DescriptionList>
					</LayerCard.Well>
				</LayerCard>

				<LayerCard padding="sm">
					<LayerCard.Header>
						<h2 className="flex items-center gap-2 text-sm font-medium">
							<Globe aria-hidden="true" className="h-4 w-4 text-basalt-primary" />
							登录与网络
						</h2>
					</LayerCard.Header>
					<LayerCard.Well className="flex-1 space-y-4">
						{/* 登录 IP — persistent users.reg_ip / users.last_ip. */}
						<DescriptionList columns={1}>
							<DescriptionList.Item term="注册 IP">
								<div className="flex flex-wrap items-center gap-1">
									<span className="min-w-0 break-all font-mono">{fmtIp(user.regIp)}</span>
									<IpLookupInline ip={user.regIp} />
									{user.regIp && user.regIp.trim().length > 0 && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-7 px-2 text-xs"
											onClick={() => handleSearchIp("regIp", user.regIp)}
										>
											<Search className="mr-1 h-3 w-3" />
											搜索同 IP 用户
										</Button>
									)}
								</div>
							</DescriptionList.Item>
							<DescriptionList.Item term="上次登录 IP">
								<div className="flex flex-wrap items-center gap-1">
									<span className="min-w-0 break-all font-mono">{fmtIp(user.lastIp)}</span>
									<IpLookupInline ip={user.lastIp} />
									{user.lastIp && user.lastIp.trim().length > 0 && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-7 px-2 text-xs"
											onClick={() => handleSearchIp("lastIp", user.lastIp)}
										>
											<Search className="mr-1 h-3 w-3" />
											搜索同 IP 用户
										</Button>
									)}
								</div>
							</DescriptionList.Item>
						</DescriptionList>

						{/* G.5: current online soft signal — only shown when worker
						    attached a fresh `online:<uid>` KV snapshot (TTL ≤15min).
						    Whole block hides when the user is not currently online. */}
						{user.onlineIp && user.onlineIp.trim().length > 0 && (
							<div className="space-y-2">
								<div className="text-xs text-basalt-muted-foreground">
									最近在线记录 · 15 分钟内的活动信号
								</div>
								<DescriptionList columns={1}>
									<DescriptionList.Item term="当前 IP">
										<div className="flex flex-wrap items-center gap-1">
											<span className="min-w-0 break-all font-mono">{fmtIp(user.onlineIp)}</span>
											<IpLookupInline ip={user.onlineIp} />
										</div>
									</DescriptionList.Item>
									{user.onlinePage && (
										<DescriptionList.Item term="当前页面">
											<div className="break-all font-mono">{user.onlinePage}</div>
										</DescriptionList.Item>
									)}
									{user.onlineTs && user.onlineTs > 0 && (
										<DescriptionList.Item term="心跳时间">
											{fmtTimestamp(user.onlineTs)}
										</DescriptionList.Item>
									)}
								</DescriptionList>
							</div>
						)}
					</LayerCard.Well>
				</LayerCard>

				{/*
				 * Write-permission checklist. Tombstone users get no card —
				 * every row would just render "status skip" (same short-
				 * circuit rationale as the previous <UserCheckinPanel> guard).
				 */}
				{!tombstoned && <UserWritePermissionCard user={user} />}
			</div>

			<LayerCard padding="sm">
				<LayerCard.Header>
					<h2 className="flex items-center gap-2 text-sm font-medium">
						<Files aria-hidden="true" className="h-4 w-4 text-basalt-primary" />
						用户内容
					</h2>
				</LayerCard.Header>
				<LayerCard.Well className="flex-1">
					<Tabs
						className="space-y-3"
						value={activeContentTab}
						onValueChange={(value) => setActiveContentTab(value as "threads" | "posts")}
					>
						<TabsList aria-label={"切换用户内容视图"} className="max-w-full overflow-x-auto">
							{[
								{
									value: "threads",
									label: `主题（${formatNumber(user.threads)}）`,
								},
								{
									value: "posts",
									label: `帖子（含首帖 · ${formatNumber(user.posts)}）`,
								},
							].map((option) => (
								<TabsTrigger key={option.value} value={option.value}>
									{option.label}
								</TabsTrigger>
							))}
						</TabsList>

						<TabsContent value="threads" aria-label="用户主题列表" className="space-y-2">
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
						</TabsContent>

						<TabsContent value="posts" aria-label="用户帖子列表" className="space-y-2">
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
						</TabsContent>
					</Tabs>
				</LayerCard.Well>
			</LayerCard>

			{/*
			 * Row 2 — check-in panel. Renders its own internal 3:1 split
			 * (aggregate + timeline on the left, streak-override on the
			 * right) so this file just supplies it a single slot.
			 */}
			{!tombstoned && (
				<>
					<Separator className="border-basalt-border" decorative={false} />
					<UserCheckinPanel userId={user.id} />
				</>
			)}

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
				description={`将永久删除 ${user.username} 的全部主题、帖子、点评、附件、私信和存储文件，并清除账号资料。此操作不可逆，无法恢复。`}
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
		<Button
			type="button"
			onClick={onClick}
			className="h-auto justify-start gap-1 p-0 text-basalt-muted-foreground"
			variant="ghost"
			size="sm"
		>
			<ArrowLeft className="h-4 w-4" />
			返回用户列表
		</Button>
	);
}

/**
 * Header-right action cluster. Split out from the main panel so
 * `UserDetailPanel`'s cognitive complexity stays under biome's 25 cap
 * even after inlining these branches. Behaviour is identical to the
 * old bottom-of-page "操作" card — only the mount point moved.
 */
interface UserActionButtonsProps {
	user: User;
	unbanLoading: boolean;
	onEdit: () => void;
	onOpenBan: () => void;
	onUnban: () => void;
	onOpenPurge: () => void;
}

function UserActionButtons({
	user,
	unbanLoading,
	onEdit,
	onOpenBan,
	onUnban,
	onOpenPurge,
}: UserActionButtonsProps) {
	if (user.status === -99) {
		return (
			<p className="text-sm text-basalt-muted-foreground">此用户已被彻底清除，无法再编辑或封禁。</p>
		);
	}
	return (
		<div className="flex flex-wrap items-center justify-end gap-2">
			<Button variant="outline" size="sm" onClick={onEdit}>
				<Pencil className="mr-1 h-4 w-4" />
				编辑资料
			</Button>
			{user.status !== -1 && (
				<Button variant="destructive" size="sm" onClick={onOpenBan}>
					<Shield className="mr-1 h-4 w-4" />
					封禁用户
				</Button>
			)}
			{user.status === -1 && (
				<Button variant="outline" size="sm" onClick={onUnban} disabled={unbanLoading}>
					<ShieldOff className="mr-1 h-4 w-4" />
					{unbanLoading ? "解除中..." : "解除封禁"}
				</Button>
			)}
			<Button variant="destructive" size="sm" onClick={onOpenPurge} data-testid="purge-user-button">
				<Trash2 className="mr-1 h-4 w-4" />
				彻底清除
			</Button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Column definitions (extracted so the JSX above stays readable)
// ---------------------------------------------------------------------------

const threadColumns: ColumnDef<Thread>[] = [
	{
		key: "subject",
		header: "标题",
		cell: (t) => {
			const subject = contentToText(t.subject);
			return (
				<Link
					href={`/admin/threads/${t.id}`}
					className="block max-w-xl truncate font-medium hover:underline"
					title={subject}
				>
					{subject}
				</Link>
			);
		},
	},
	{
		key: "replies",
		header: "回复",
		cell: (t) => formatNumber(t.replies),
		className: "text-right tabular-nums",
	},
	{
		key: "views",
		header: "浏览",
		cell: (t) => formatNumber(t.views),
		className: "text-right tabular-nums",
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
		cell: (p) => {
			const subject = contentToText(p.threadSubject) || `#${p.threadId}`;
			return (
				<Link
					href={`/admin/threads/${p.threadId}`}
					className="block max-w-72 truncate hover:underline"
					title={subject}
				>
					{subject}
				</Link>
			);
		},
	},
	{
		key: "content",
		header: "内容",
		cell: (p) => {
			const content = contentToText(p.content);
			return (
				<span
					className="line-clamp-2 min-w-48 max-w-xl whitespace-normal break-words text-sm"
					title={content}
				>
					{content}
				</span>
			);
		},
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
