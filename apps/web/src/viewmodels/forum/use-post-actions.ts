// viewmodels/forum/use-post-actions.ts — ViewModel for post actions (edit/delete)
// MVVM Pattern: Encapsulates all post action state and logic, View receives only callbacks and state.

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useForumToast } from "@/components/forum/forum-toast";
import { deleteMyPost, deletePost, editMyPost, editPost } from "@/lib/moderation-api";

/**
 * Post action state returned by usePostActions
 */
export interface PostActionsState {
	/** Edit dialog open state */
	editDialogOpen: boolean;
	/** Delete confirmation dialog open state */
	deleteDialogOpen: boolean;
	/** Delete operation in progress */
	deleting: boolean;
	/** Delete error message (null if no error) */
	deleteError: string | null;
}

/**
 * Post action callbacks returned by usePostActions
 */
export interface PostActionsCallbacks {
	/** Open edit dialog */
	handleEdit: () => void;
	/** Close edit dialog */
	handleEditClose: () => void;
	/** Open delete confirmation dialog */
	handleDeleteClick: () => void;
	/** Close delete confirmation dialog */
	handleDeleteClose: () => void;
	/** Confirm and execute delete */
	handleDeleteConfirm: () => Promise<void>;
}

/**
 * Combined return type for usePostActions
 */
export interface UsePostActionsReturn {
	state: PostActionsState;
	actions: PostActionsCallbacks;
}

/**
 * Options for usePostActions hook
 */
export interface UsePostActionsOptions {
	/** Post ID */
	postId: number;
	/** Whether this is the user's own post */
	isOwnPost: boolean;
	/** Whether user has moderation permissions */
	canModerate: boolean;
	/** Callback after successful delete (defaults to router.refresh) */
	onDeleteSuccess?: () => void;
}

/**
 * ViewModel hook for post edit/delete actions.
 * Encapsulates dialog state, loading state, error handling, and API calls.
 *
 * @example
 * ```tsx
 * const { state, actions } = usePostActions({
 *   postId: post.id,
 *   isOwnPost: post.authorId === currentUserId,
 *   canModerate: userRole >= ROLE_MODERATOR,
 * });
 *
 * return (
 *   <>
 *     <Button onClick={actions.handleEdit}>Edit</Button>
 *     <Button onClick={actions.handleDeleteClick}>Delete</Button>
 *     <EditDialog open={state.editDialogOpen} onOpenChange={actions.handleEditClose} />
 *     <ConfirmDialog
 *       open={state.deleteDialogOpen}
 *       loading={state.deleting}
 *       error={state.deleteError}
 *       onConfirm={actions.handleDeleteConfirm}
 *     />
 *   </>
 * );
 * ```
 */
export function usePostActions({
	postId,
	isOwnPost,
	canModerate,
	onDeleteSuccess,
}: UsePostActionsOptions): UsePostActionsReturn {
	const router = useRouter();
	const toast = useForumToast();

	// Dialog state
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	// Delete operation state
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	// Edit actions
	const handleEdit = useCallback(() => {
		setEditDialogOpen(true);
	}, []);

	const handleEditClose = useCallback(() => {
		setEditDialogOpen(false);
	}, []);

	// Delete actions
	const handleDeleteClick = useCallback(() => {
		setDeleteError(null);
		setDeleteDialogOpen(true);
	}, []);

	const handleDeleteClose = useCallback(() => {
		setDeleteDialogOpen(false);
	}, []);

	const handleDeleteConfirm = useCallback(async () => {
		setDeleting(true);
		setDeleteError(null);
		try {
			// Use user self-service API if own post, otherwise moderation API
			if (isOwnPost) {
				await deleteMyPost(postId);
			} else if (canModerate) {
				await deletePost(postId);
			} else {
				throw new Error("没有删除权限");
			}
			setDeleteDialogOpen(false);
			toast.success("回复已删除");
			if (onDeleteSuccess) {
				onDeleteSuccess();
			} else {
				router.refresh();
			}
		} catch (err) {
			const message = err instanceof Error && err.message ? err.message : "删除失败";
			setDeleteError(message);
			toast.error({ title: "删除失败", description: message });
		} finally {
			setDeleting(false);
		}
	}, [postId, isOwnPost, canModerate, router, onDeleteSuccess, toast]);

	return {
		state: {
			editDialogOpen,
			deleteDialogOpen,
			deleting,
			deleteError,
		},
		actions: {
			handleEdit,
			handleEditClose,
			handleDeleteClick,
			handleDeleteClose,
			handleDeleteConfirm,
		},
	};
}

// ─── Pure Helper Functions (testable without hooks) ─────────────────────

/**
 * Determine which delete API to use based on ownership and permissions.
 * Pure function for testing.
 */
export function getDeleteStrategy(
	isOwnPost: boolean,
	canModerate: boolean,
): "self" | "moderate" | "none" {
	if (isOwnPost) return "self";
	if (canModerate) return "moderate";
	return "none";
}

/**
 * Execute post deletion using the appropriate API.
 * Extracted for testability.
 */
export async function executePostDelete(
	postId: number,
	strategy: "self" | "moderate",
): Promise<void> {
	if (strategy === "self") {
		await deleteMyPost(postId);
	} else {
		await deletePost(postId);
	}
}

/**
 * Execute post edit using the appropriate API.
 * Extracted for testability.
 */
export async function executePostEdit(
	postId: number,
	content: string,
	isOwnPost: boolean,
	canModerate: boolean,
): Promise<void> {
	if (isOwnPost) {
		await editMyPost(postId, content);
	} else if (canModerate) {
		await editPost(postId, content);
	} else {
		throw new Error("没有编辑权限");
	}
}
