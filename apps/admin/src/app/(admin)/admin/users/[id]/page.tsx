"use client";

// Admin User Detail Page (View layer)
// MVVM: ViewModel is `useUserDetail`. Mutation handlers (edit/unban) are
// inlined here because they only run from this single page; no shared
// dialog state is needed beyond the existing UserEditDialog.
//
// Scope (D2): basic info card, meta card (incl. reg_ip / last_ip plain
// display — same-IP query lands in D3), threads / posts tabs with
// pagination, danger zone with 编辑 + 解除封禁 (when banned). The full
// purge action arrives in D4; we leave a placeholder card so the
// information architecture is visible during review.

import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { extractErrorMessage } from "@/lib/admin-error";
import type { Post } from "@/viewmodels/admin/posts";
import type { Thread } from "@/viewmodels/admin/threads";
import { useUserDetail } from "@/viewmodels/admin/use-user-detail";
import {
	type User,
	type UserUpdate,
	roleLabel,
	statusLabel,
	updateUser,
} from "@/viewmodels/admin/users";
import { formatNumber } from "@ellie/shared";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@ellie/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ellie/ui";
import { ArrowLeft, Loader2, Pencil, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusVariant(status: number): "default" | "destructive" | "secondary" | "outline" {
	switch (status) {
		case -1:
			return "destructive";
		case -2:
			return "secondary";
		default:
			return "default";
	}
}

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

	const [unbanLoading, setUnbanLoading] = useState(false);
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
			await updateUser(user.id, { status: 0 });
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
		<div className="space-y-4">
			<BackLink />

			{/* Header */}
			<div className="flex items-center gap-4">
				<div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-lg font-medium">
					{user.username[0]?.toUpperCase() ?? "?"}
				</div>
				<div className="flex-1">
					<h1 className="text-2xl font-semibold text-foreground">{user.username}</h1>
					<div className="mt-1 flex items-center gap-2">
						<Badge variant={statusVariant(user.status)}>{statusLabel(user.status)}</Badge>
						<Badge variant="outline">{roleLabel(user.role)}</Badge>
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
					<CardContent>
						<dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
							<dt className="text-muted-foreground">注册 IP</dt>
							<dd className="font-mono">{fmtIp(user.regIp)}</dd>
							<dt className="text-muted-foreground">最近 IP</dt>
							<dd className="font-mono">{fmtIp(user.lastIp)}</dd>
						</dl>
						<p className="mt-3 text-xs text-muted-foreground">同 IP 用户查询将在 D3 启用。</p>
					</CardContent>
				</Card>
			</div>

			{/* Threads + Posts tabs */}
			<Card>
				<CardHeader>
					<CardTitle>用户内容</CardTitle>
				</CardHeader>
				<CardContent>
					<Tabs defaultValue="threads">
						<TabsList>
							<TabsTrigger value="threads">主题（{formatNumber(user.threads)}）</TabsTrigger>
							<TabsTrigger value="posts">帖子（{formatNumber(user.posts)}）</TabsTrigger>
						</TabsList>

						<TabsContent value="threads" className="mt-4 space-y-2">
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

						<TabsContent value="posts" className="mt-4 space-y-2">
							{state.postsError && <AdminInlineMessage variant="error" text={state.postsError} />}
							<AdminDataTable<Post>
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
				</CardContent>
			</Card>

			{/* Danger zone */}
			<Card>
				<CardHeader>
					<CardTitle>操作</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
							<Pencil className="mr-1 h-4 w-4" />
							编辑资料
						</Button>
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
					</div>
					<p className="mt-3 text-xs text-muted-foreground">
						封禁并彻底清除（删除主题/帖子/附件/站内信，并 tombstone 用户）将在 D4 启用。
					</p>
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

const postColumns: ColumnDef<Post>[] = [
	{
		key: "thread",
		header: "所在主题",
		cell: (p) => (
			<Link href={`/admin/threads/${p.threadId}`} className="hover:underline">
				#{p.threadId}
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
		cell: (p) => (p.isFirst ? <Badge variant="outline">是</Badge> : "—"),
	},
	{
		key: "createdAt",
		header: "时间",
		cell: (p) => fmtTimestamp(p.createdAt),
	},
];
