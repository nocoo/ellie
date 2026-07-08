"use client";

// UserDetailDialog — task #9 Phase C.
//
// Wraps `<UserDetailPanel>` inside a wide admin dialog so the users
// list page can open a user's detail without navigating away. The list
// page's pagination / filter / selection state lives in the
// `useUsersAdmin` hook and is completely unaffected by mounting this
// dialog — closing it returns the operator to the exact same scroll
// position, filter set, and selected ids they had on open.
//
// Why a separate file from `UserDetailPanel`:
//   - The panel is also mounted directly by the standalone route
//     `/admin/users/[id]/page.tsx`. Keeping the dialog wrapper out of
//     the panel file means the route version never pulls in dialog
//     chrome it doesn't need.
//   - `dialog-presets.ts` (`ADMIN_WIDE_DIALOG_CONTENT_CLASS` +
//     `ADMIN_WIDE_DIALOG_BODY_CLASS`) is the project's canonical wide-
//     detail-dialog skin; pinning to that keeps width / scroll
//     behaviour consistent with the KV / log / report detail dialogs.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ellie/ui";
import { type UserDetailChangeKind, UserDetailPanel } from "@/components/admin/user-detail-panel";
import { ADMIN_WIDE_DIALOG_BODY_CLASS } from "./dialog-presets";

export interface UserDetailDialogProps {
	/**
	 * The user id to view. When `null` the dialog stays closed regardless
	 * of any other prop — the list page uses this single field to drive
	 * open/close instead of a separate boolean so opening a different
	 * user from the row click is just `setDetailUserId(id)`.
	 */
	userId: number | null;

	/**
	 * Close the dialog. Called by the shadcn Dialog `onOpenChange(false)`
	 * route (overlay click / ESC / explicit close button) and by the
	 * panel's `onChanged({ kind: "purge" })` follow-up so the dialog
	 * disappears once the user has been tombstoned (the panel itself
	 * switches to a "已彻底清除" placeholder, but the operator usually
	 * wants to return to the list at that point).
	 */
	onClose: () => void;

	/**
	 * Update the list page's IP filter in-place. Called when the panel's
	 * 搜索同 IP 用户 button (wired in Phase C.1 — see `UserDetailPanel`'s
	 * `handleSearchIp`) is clicked. The list page's
	 * `handleDialogSearchIp` clears both IP keys before applying the new
	 * one so the worker never sees an AND of `regIp` + `lastIp`, and
	 * closes the dialog so the operator lands directly on the freshly
	 * filtered list.
	 */
	onSearchIp?: (kind: "regIp" | "lastIp", ip: string) => void;

	/**
	 * Refresh the list page's current row data after a successful
	 * edit/ban/unban/purge inside the dialog. Without this the badge
	 * column would stay stale after the dialog closes.
	 */
	onChanged?: (event: { kind: UserDetailChangeKind; userId: number }) => void;
}

export function UserDetailDialog({
	userId,
	onClose,
	onSearchIp,
	onChanged,
}: UserDetailDialogProps) {
	const open = userId !== null;
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			{/*
			 * Wider than dialog-presets.ts's default (max-w-5xl) because the
			 * refactored panel puts four modules on a single row (基本资料 /
			 * 元信息 / 用户内容 / 写权限体检) — 5xl was cramping every column
			 * to ~200px on 1440p screens. Padding trimmed via `p-6` to match
			 * shadcn dialog conventions now that we own the internal grid.
			 */}
			<DialogContent className="w-[calc(100vw-2rem)] max-w-[min(1440px,calc(100vw-2rem))] overflow-hidden p-6 sm:max-w-[min(1440px,calc(100vw-2rem))]">
				<DialogHeader className="min-w-0">
					<DialogTitle>用户详情</DialogTitle>
				</DialogHeader>
				{userId !== null && (
					<div className={ADMIN_WIDE_DIALOG_BODY_CLASS}>
						<UserDetailPanel
							userId={userId}
							showBack={false}
							onSearchIp={onSearchIp}
							onChanged={onChanged}
						/>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
