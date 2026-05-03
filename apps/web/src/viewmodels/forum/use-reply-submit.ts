// viewmodels/forum/use-reply-submit.ts — ViewModel for reply submission
// MVVM Pattern: Encapsulates all reply submission state and logic.

"use client";

import { ApiError, apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-messages";
import { stripHtmlTags } from "@/lib/text";
import type { Post } from "@ellie/types";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

/**
 * Reply submission state returned by useReplySubmit
 */
export interface ReplySubmitState {
	/** Submission in progress */
	submitting: boolean;
	/** Error message (null if no error) */
	error: string | null;
}

/**
 * Reply submission callbacks returned by useReplySubmit
 */
export interface ReplySubmitCallbacks {
	/** Submit the reply */
	handleSubmit: (html: string) => Promise<void>;
	/** Clear error state */
	clearError: () => void;
}

/**
 * Combined return type for useReplySubmit
 */
export interface UseReplySubmitReturn {
	state: ReplySubmitState;
	actions: ReplySubmitCallbacks;
}

/**
 * Options for useReplySubmit hook
 */
export interface UseReplySubmitOptions {
	/** Thread ID to reply to */
	threadId: number;
	/** Close the dialog before navigating */
	onClose?: () => void;
	/** Quoted content (plain text snippet) */
	quotedContent?: string;
	/** Quoted author name */
	quotedAuthor?: string;
	/** Quoted post time */
	quotedTime?: string;
	/** Minimum content length (default: 2) */
	minContentLength?: number;
}

/**
 * Validation result for reply content
 */
export interface ContentValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Validate reply content before submission.
 * Pure function for testability.
 */
export function validateReplyContent(html: string, minLength = 2): ContentValidationResult {
	const strippedContent = stripHtmlTags(html).trim();
	if (strippedContent.length < minLength) {
		return { valid: false, error: "内容太短，请输入更多内容" };
	}
	return { valid: true };
}

/**
 * Build quoted content HTML for reply.
 * Pure function for generating quote blocks.
 * Uses div.quote structure matching Discuz migration format.
 *
 * @param quotedContent - The content being quoted
 * @param quotedAuthor - Author name
 * @param quotedTime - Optional post time (formatted string)
 */
export function buildQuotedContent(
	quotedContent: string | undefined,
	quotedAuthor: string | undefined,
	quotedTime?: string,
): string {
	if (!quotedContent || !quotedAuthor) {
		return "";
	}
	const timeStr = quotedTime ? ` 发表于 ${quotedTime}` : "";
	return `<div class="quote"><span class="quote-header"><strong>${quotedAuthor}</strong>${timeStr}</span><blockquote>${quotedContent}</blockquote></div><p></p>`;
}

/**
 * Submit a reply to the API.
 * Extracted for testability and reuse.
 */
export async function submitReply(threadId: number, content: string): Promise<Post> {
	const res = await apiClient.post<Post>("/api/v1/posts", {
		threadId,
		content,
	});
	return res.data;
}

/**
 * ViewModel hook for reply submission.
 * Encapsulates validation, submission state, error handling, and API calls.
 *
 * @example
 * ```tsx
 * const { state, actions } = useReplySubmit({
 *   threadId: 123,
 *   onSuccess: () => onOpenChange(false),
 * });
 *
 * return (
 *   <>
 *     {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
 *     <PostEditor onSubmit={actions.handleSubmit} submitting={state.submitting} />
 *   </>
 * );
 * ```
 */
export function useReplySubmit({
	threadId,
	onClose,
	quotedContent,
	quotedAuthor,
	quotedTime,
	minContentLength = 2,
}: UseReplySubmitOptions): UseReplySubmitReturn {
	const router = useRouter();

	// Submission state
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const handleSubmit = useCallback(
		async (html: string) => {
			// Validate content
			const validation = validateReplyContent(html, minContentLength);
			if (!validation.valid) {
				setError(validation.error ?? "内容验证失败");
				return;
			}

			setSubmitting(true);
			setError(null);

			try {
				const quoteHtml = buildQuotedContent(quotedContent, quotedAuthor, quotedTime);
				const finalContent = quoteHtml ? quoteHtml + html : html;
				const post = await submitReply(threadId, finalContent);
				onClose?.();
				router.push(`/threads/${threadId}?last=1#post-${post.id}`);
			} catch (err) {
				const code = err instanceof ApiError ? err.code : undefined;
				const message = getErrorMessage(code, "reply");
				setError(message);
				setSubmitting(false);
			}
		},
		[threadId, minContentLength, quotedContent, quotedAuthor, quotedTime, onClose, router],
	);

	return {
		state: {
			submitting,
			error,
		},
		actions: {
			handleSubmit,
			clearError,
		},
	};
}
