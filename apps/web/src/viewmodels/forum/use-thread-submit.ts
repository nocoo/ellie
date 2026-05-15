// viewmodels/forum/use-thread-submit.ts — ViewModel for new thread submission
// MVVM Pattern: Encapsulates all thread creation state and logic.

"use client";

import { useForumToast } from "@/components/forum/forum-toast";
import { ApiError, apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-messages";
import { stripHtmlTags } from "@/lib/text";
import { mapCreateThreadTypeError } from "@/viewmodels/forum/thread-types";
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
	/**
	 * Currently selected 主题分类 typeId. `null` = "no selection".
	 * Picker UI only sets positive ids; `null` survives required pre-flight
	 * by becoming a local validation error rather than a request.
	 */
	typeId: number | null;
}

/**
 * Thread submission callbacks returned by useThreadSubmit
 */
export interface ThreadSubmitCallbacks {
	/** Update subject */
	setSubject: (subject: string) => void;
	/** Select / clear 主题分类 typeId. Pass `null` to clear. */
	setTypeId: (typeId: number | null) => void;
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
	/**
	 * Whether 主题分类 is required on this forum. When true, the caller
	 * must select a positive `typeId` before `handleSubmit` will attempt
	 * a request — local validation surfaces the picker error and never
	 * round-trips to the Worker. Defaults to `false`.
	 */
	typeIdRequired?: boolean;
}

/**
 * Thread validation state
 */
export interface ThreadValidation {
	/** Subject validation error (null if valid) */
	subjectError: string | null;
	/** 主题分类 picker error (null if valid / no picker) */
	typeIdError: string | null;
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
	typeIdRequired = false,
	typeId: number | null = null,
): boolean {
	const trimmed = subject.trim();
	const subjectOk =
		trimmed.length >= minSubjectLength && trimmed.length <= maxSubjectLength && !submitting;
	if (!subjectOk) return false;
	if (typeIdRequired && (typeId == null || typeId <= 0)) return false;
	return true;
}

/**
 * Submit a new thread to the API.
 * Extracted for testability.
 *
 * Only includes `typeId` in the POST body when the caller has a valid
 * positive selection — `null` / `0` / negatives are dropped so the
 * Worker sees a clean "no category" request rather than rejecting the
 * body. The caller is responsible for whitelist normalization before
 * this point.
 */
export async function submitThread(
	forumId: number,
	subject: string,
	content: string,
	typeId?: number | null,
): Promise<number | undefined> {
	const body: Record<string, unknown> = {
		forumId,
		subject: subject.trim(),
		content,
	};
	if (typeId != null && typeId > 0) body.typeId = typeId;
	const response = await apiClient.post<CreateThreadResponse>("/api/v1/threads", body);
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
	typeIdRequired = false,
}: UseThreadSubmitOptions): UseThreadSubmitReturn {
	const router = useRouter();
	const toast = useForumToast();

	// State
	const [subject, setSubject] = useState("");
	const [typeId, setTypeId] = useState<number | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Computed validation
	const subjectValidation = validateSubject(subject, minSubjectLength, maxSubjectLength);
	const subjectError =
		subject.trim().length > 0 && !subjectValidation.valid
			? (subjectValidation.error ?? null)
			: null;
	// Picker is required and nothing selected → surface inline hint
	// immediately (reviewer pin msg fec9f031: required-未选 必须显示 inline
	// 提示而不是只有 submit 后才出现，因为 canSubmit 会先把按钮禁掉).
	// Intentionally NOT routed through `state.error` so the dialog's top
	// red banner doesn't get a permanent occupant.
	const typeIdMissing = typeIdRequired && (typeId == null || typeId <= 0);
	const typeIdError: string | null = typeIdMissing ? TYPE_REQUIRED_ERROR : null;
	const canSubmit = canSubmitThread(
		subject,
		submitting,
		minSubjectLength,
		maxSubjectLength,
		typeIdRequired,
		typeId,
	);

	// Actions
	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const reset = useCallback(() => {
		setSubject("");
		setTypeId(null);
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

			// Required 主题分类 pre-flight — never round-trip to the Worker
			// when we know the picker is unsatisfied (reviewer pin msg
			// 9154cc68: "required 客户端本地阻断且不发请求"). The inline
			// picker hint is already on screen via `typeIdError`; we
			// deliberately do NOT route this through `state.error` so the
			// dialog's top red banner stays empty for clean states.
			if (typeIdRequired && (typeId == null || typeId <= 0)) {
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
				const threadId = await submitThread(forumId, subject, html, typeId);

				if (onSuccess) {
					onSuccess();
				}
				reset();
				toast.success("主题已发布");

				// Navigate to the new thread
				if (threadId) {
					router.push(`/threads/${threadId}`);
				} else {
					router.refresh();
				}
			} catch (err) {
				const code = err instanceof ApiError ? err.code : undefined;
				// Prefer thread-types friendly mapping; if the server message
				// doesn't look like a typeId problem, fall back to the
				// generic code-keyed copy. We do NOT invent a fake code here
				// (reviewer pin msg 6717fc27 #5).
				const typeMessage = mapCreateThreadTypeError(err);
				const message = typeMessage ?? getErrorMessage(code, "createThread");
				setError(message);
				toast.error({ title: "发帖失败", description: message });
				setSubmitting(false);
			}
		},
		[
			forumId,
			subject,
			typeId,
			typeIdRequired,
			minSubjectLength,
			maxSubjectLength,
			minContentLength,
			onSuccess,
			reset,
			router,
			toast,
		],
	);

	return {
		state: {
			submitting,
			error,
			subject,
			typeId,
		},
		actions: {
			setSubject,
			setTypeId,
			handleSubmit,
			clearError,
			reset,
		},
		validation: {
			subjectError,
			typeIdError,
			canSubmit,
		},
	};
}

const TYPE_REQUIRED_ERROR = "请选择主题分类";
