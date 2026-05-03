// viewmodels/forum/use-thread-submit.ts — ViewModel for new thread submission
// MVVM Pattern: Encapsulates all thread creation state and logic.

"use client";

import { ApiError, apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-messages";
import { stripHtmlTags } from "@/lib/text";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Thread submission state returned by useThreadSubmit
 */
export interface ThreadSubmitState {
	/** Submission in progress */
	submitting: boolean;
	/** Error message (null if no error) */
	error: string | null;
	/** Thread subject */
	subject: string;
}

/**
 * Thread submission callbacks returned by useThreadSubmit
 */
export interface ThreadSubmitCallbacks {
	/** Update subject */
	setSubject: (subject: string) => void;
	/** Submit the thread */
	handleSubmit: (html: string) => Promise<void>;
	/** Clear error state */
	clearError: () => void;
	/** Reset all state */
	reset: () => void;
}

/**
 * Combined return type for useThreadSubmit
 */
export interface UseThreadSubmitReturn {
	state: ThreadSubmitState;
	actions: ThreadSubmitCallbacks;
	/** Computed validation state */
	validation: ThreadValidation;
}

/**
 * Options for useThreadSubmit hook
 */
export interface UseThreadSubmitOptions {
	/** Forum ID to create thread in */
	forumId: number;
	/** Callback after successful submission */
	onSuccess?: () => void;
	/** Minimum subject length (default: 4) */
	minSubjectLength?: number;
	/** Maximum subject length (default: 100) */
	maxSubjectLength?: number;
	/** Minimum content length (default: 10) */
	minContentLength?: number;
}

/**
 * Thread validation state
 */
export interface ThreadValidation {
	/** Subject validation error (null if valid) */
	subjectError: string | null;
	/** Whether the form can be submitted */
	canSubmit: boolean;
}

/**
 * Response from create thread API
 */
interface CreateThreadResponse {
	id: number;
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Validate thread subject.
 * Pure function for testability.
 */
export function validateSubject(
	subject: string,
	minLength = 4,
	maxLength = 100,
): { valid: boolean; error?: string } {
	const trimmed = subject.trim();
	if (trimmed.length === 0) {
		return { valid: true }; // Empty is allowed (not touched yet)
	}
	if (trimmed.length < minLength) {
		return { valid: false, error: `标题至少需要${minLength}个字符` };
	}
	if (trimmed.length > maxLength) {
		return { valid: false, error: `标题不能超过${maxLength}个字符` };
	}
	return { valid: true };
}

/**
 * Validate thread content.
 * Pure function for testability.
 */
export function validateContent(html: string, minLength = 10): { valid: boolean; error?: string } {
	const strippedContent = stripHtmlTags(html).trim();
	if (strippedContent.length < minLength) {
		return { valid: false, error: `内容太短，请输入更多内容（至少${minLength}个字符）` };
	}
	return { valid: true };
}

/**
 * Check if form can be submitted.
 * Pure function for testability.
 */
export function canSubmitThread(
	subject: string,
	submitting: boolean,
	minSubjectLength = 4,
	maxSubjectLength = 100,
): boolean {
	const trimmed = subject.trim();
	return trimmed.length >= minSubjectLength && trimmed.length <= maxSubjectLength && !submitting;
}

/**
 * Submit a new thread to the API.
 * Extracted for testability.
 */
export async function submitThread(
	forumId: number,
	subject: string,
	content: string,
): Promise<number | undefined> {
	const response = await apiClient.post<CreateThreadResponse>("/api/v1/threads", {
		forumId,
		subject: subject.trim(),
		content,
	});
	return response.data?.id;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * ViewModel hook for new thread submission.
 * Encapsulates validation, submission state, error handling, and API calls.
 *
 * @example
 * ```tsx
 * const { state, actions, validation } = useThreadSubmit({
 *   forumId: 123,
 *   onSuccess: () => onOpenChange(false),
 * });
 *
 * return (
 *   <>
 *     <input value={state.subject} onChange={(e) => actions.setSubject(e.target.value)} />
 *     {validation.subjectError && <Error>{validation.subjectError}</Error>}
 *     <PostEditor onSubmit={actions.handleSubmit} submitting={state.submitting} />
 *   </>
 * );
 * ```
 */
export function useThreadSubmit({
	forumId,
	onSuccess,
	minSubjectLength = 4,
	maxSubjectLength = 100,
	minContentLength = 10,
}: UseThreadSubmitOptions): UseThreadSubmitReturn {
	const router = useRouter();

	// State
	const [subject, setSubject] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Computed validation
	const subjectValidation = validateSubject(subject, minSubjectLength, maxSubjectLength);
	const subjectError =
		subject.trim().length > 0 && !subjectValidation.valid
			? (subjectValidation.error ?? null)
			: null;
	const canSubmit = canSubmitThread(subject, submitting, minSubjectLength, maxSubjectLength);

	// Actions
	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const reset = useCallback(() => {
		setSubject("");
		setError(null);
	}, []);

	const handleSubmit = useCallback(
		async (html: string) => {
			// Validate subject
			const subjectResult = validateSubject(subject, minSubjectLength, maxSubjectLength);
			if (!subjectResult.valid) {
				setError(`请输入标题（至少${minSubjectLength}个字符）`);
				return;
			}

			// Validate content
			const contentResult = validateContent(html, minContentLength);
			if (!contentResult.valid) {
				setError(contentResult.error ?? "内容验证失败");
				return;
			}

			setSubmitting(true);
			setError(null);

			try {
				const threadId = await submitThread(forumId, subject, html);

				if (onSuccess) {
					onSuccess();
				}
				reset();

				// Navigate to the new thread
				if (threadId) {
					router.push(`/threads/${threadId}`);
				} else {
					router.refresh();
				}
			} catch (err) {
				const code = err instanceof ApiError ? err.code : undefined;
				const message = getErrorMessage(code, "createThread");
				setError(message);
				setSubmitting(false);
			}
		},
		[
			forumId,
			subject,
			minSubjectLength,
			maxSubjectLength,
			minContentLength,
			onSuccess,
			reset,
			router,
		],
	);

	return {
		state: {
			submitting,
			error,
			subject,
		},
		actions: {
			setSubject,
			handleSubmit,
			clearError,
			reset,
		},
		validation: {
			subjectError,
			canSubmit,
		},
	};
}
