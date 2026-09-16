// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CensorWordCreateDialog } from "@/components/admin/censor-word-create-dialog";
import { IpBanCreateDialog } from "@/components/admin/ip-ban-create-dialog";
import { PostEditDialog } from "@/components/admin/post-edit-dialog";
import { ThreadEditDialog } from "@/components/admin/thread-edit-dialog";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { UserWritePermissionCard } from "@/components/admin/user-write-permission-card";
import type { Post } from "@/viewmodels/admin/posts";
import type { Thread } from "@/viewmodels/admin/threads";
import type { User } from "@/viewmodels/admin/users";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const user: User = {
	id: 42,
	username: "alice",
	email: "alice@test.local",
	avatar: "",
	role: 0,
	status: 0,
	threads: 2,
	posts: 5,
	credits: 10,
	coins: 20,
	regDate: 1_700_000_000,
	lastLogin: 1_700_000_100,
	regIp: "::1",
	lastIp: "127.0.0.1",
	emailVerifiedAt: 1_700_000_001,
};
const thread: Thread = {
	id: 7,
	subject: "Original title",
	forumId: 1,
	authorId: 42,
	authorName: "alice",
	authorAvatar: "",
	authorAvatarPath: "",
	replies: 0,
	views: 1,
	sticky: 0,
	closed: 0,
	digest: 0,
	highlight: 0,
	lastPostAt: 0,
	lastPoster: "",
	lastPosterId: 0,
	lastPosterAvatar: "",
	lastPosterAvatarPath: "",
	createdAt: 1_700_000_000,
	typeName: "",
	special: 0,
	recommends: 0,
	isAuthorFirstThread: false,
};
const post: Post = {
	id: 8,
	threadId: 7,
	forumId: 1,
	content: "Original content",
	authorId: 42,
	authorName: "alice",
	isFirst: true,
	position: 1,
	createdAt: 1_700_000_000,
};

it.each(["user", "thread", "post"] as const)(
	"discards a cancelled %s edit when reopened and locks dismissal during save",
	(kind) => {
		const onSave = vi.fn();
		const onOpenChange = vi.fn();
		const editor = (open: boolean, loading = false) => {
			const props = { open, loading, onSave, onOpenChange };
			if (kind === "user") return <UserEditDialog {...props} user={user} />;
			if (kind === "thread") return <ThreadEditDialog {...props} thread={thread} />;
			return <PostEditDialog {...props} post={post} />;
		};
		const label = kind === "user" ? "用户名" : kind === "thread" ? "标题" : "内容";
		const original =
			kind === "user" ? user.username : kind === "thread" ? thread.subject : post.content;
		const { rerender } = render(editor(true));
		fireEvent.change(screen.getByLabelText(label), { target: { value: "Unsaved draft" } });
		fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onSave).not.toHaveBeenCalled();
		rerender(editor(false));
		rerender(editor(true));
		expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(original);
		onOpenChange.mockClear();
		rerender(editor(true, true));
		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.click(
			screen.getByRole("button", { name: kind === "user" ? "关闭" : "关闭弹窗", exact: true }),
		);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect((screen.getByRole("button", { name: "保存中..." }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	},
);

it("shows the real default replacement and submits an explicitly empty replacement", () => {
	const onSave = vi.fn();
	const onUpdate = vi.fn();
	const props = { open: true, onOpenChange: vi.fn(), onSave, onUpdate };
	const { rerender } = render(<CensorWordCreateDialog {...props} censorWord={null} />);
	expect((screen.getByLabelText("替换内容") as HTMLInputElement).value).toBe("**");
	fireEvent.change(screen.getByLabelText("词语 / 正则"), { target: { value: "spam" } });
	fireEvent.change(screen.getByLabelText("替换内容"), { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "添加敏感词", exact: true }));
	expect(onSave).toHaveBeenCalledWith({ find: "spam", action: "replace", replacement: "" });
	const word = {
		id: 9,
		find: "spam",
		replacement: "**",
		action: "replace" as const,
		adminId: 0,
		adminName: "",
		createdAt: 0,
	};
	rerender(<CensorWordCreateDialog {...props} censorWord={word} />);
	fireEvent.change(screen.getByLabelText("替换内容"), { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
	expect(onUpdate).toHaveBeenCalledWith(9, { find: "spam", action: "replace", replacement: "" });
});

it("keeps the IP rule address read-only while allowing its reason and expiry to be cleared", () => {
	const onUpdate = vi.fn();
	render(
		<IpBanCreateDialog
			open
			onOpenChange={vi.fn()}
			onUpdate={onUpdate}
			ipBan={{
				id: 9,
				ip: "192.0.2.1",
				reason: "Old reason",
				expiresAt: 1_700_000_000,
				adminId: 0,
				adminName: "",
				createdAt: 0,
			}}
		/>,
	);
	expect((screen.getByLabelText("IP / 范围") as HTMLInputElement).readOnly).toBe(true);
	fireEvent.change(screen.getByLabelText("原因"), { target: { value: "" } });
	fireEvent.change(screen.getByLabelText("过期时间"), { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
	expect(onUpdate).toHaveBeenCalledWith(9, { reason: "", expiresAt: null });
});

it("does not claim a user can publish when current site rules failed to load", async () => {
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Rules unavailable")));
	render(<UserWritePermissionCard user={user} />);
	await waitFor(() =>
		expect(screen.getByTestId("write-permission-conclusion").textContent).toBe(
			"站点规则未加载，暂时无法确认写权限。",
		),
	);
});
