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

import { type UserDetailChangeKind, UserDetailPanel } from "@/components/admin/user-detail-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ellie/ui";
import { ADMIN_WIDE_DIALOG_BODY_CLASS, ADMIN_WIDE_DIALOG_CONTENT_CLASS } from "./dialog-presets";

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
	 * Update the list page's IP filter in-place. Called when the panel
	 * triggers an "搜索同 IP 用户" intent (Phase C only declares the
	 * upstream contract — no panel JSX wires this yet; the dialog still
	 * passes the prop so once a button is added the wrapper does not
	 * need touching).
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
			<DialogContent className={ADMIN_WIDE_DIALOG_CONTENT_CLASS}>
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
