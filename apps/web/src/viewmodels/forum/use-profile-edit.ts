// viewmodels/forum/use-profile-edit.ts — ViewModel for profile editing
// MVVM Pattern: Encapsulates all profile edit state and logic.

"use client";

import { useForumToast } from "@/components/forum/forum-toast";
import { ApiError, apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-messages";
import type { User } from "@ellie/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Profile form data shape
 */
export interface ProfileFormData {
	gender: number;
	birthYear: number;
	birthMonth: number;
	birthDay: number;
	resideProvince: string;
	resideCity: string;
	graduateSchool: string;
	bio: string;
	interest: string;
	qq: string;
	site: string;
}

/**
 * Profile edit state returned by useProfileEdit
 */
export interface ProfileEditState {
	/** Submission in progress */
	submitting: boolean;
	/** Error message (null if no error) */
	error: string | null;
	/** Form data */
	form: ProfileFormData;
}

/**
 * Profile edit callbacks returned by useProfileEdit
 */
export interface ProfileEditActions {
	/** Update a form field */
	setField: <K extends keyof ProfileFormData>(field: K, value: ProfileFormData[K]) => void;
	/** Save profile changes */
	handleSave: () => Promise<void>;
	/** Clear error state */
	clearError: () => void;
	/** Reset form to initial values */
	resetForm: () => void;
}

/**
 * Combined return type for useProfileEdit
 */
export interface UseProfileEditReturn {
	state: ProfileEditState;
	actions: ProfileEditActions;
}

/**
 * Options for useProfileEdit hook
 */
export interface UseProfileEditOptions {
	/** Initial user data to populate form */
	initialData: ProfileFormData;
	/** Whether the dialog is open (triggers form sync) */
	open: boolean;
	/** Callback after successful submission */
	onSuccess?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GENDER_OPTIONS = [
	{ value: 0, label: "未设置" },
	{ value: 1, label: "男" },
	{ value: 2, label: "女" },
];

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Create default form data.
 * Pure function for testability.
 */
export function createDefaultFormData(): ProfileFormData {
	return {
		gender: 0,
		birthYear: 0,
		birthMonth: 0,
		birthDay: 0,
		resideProvince: "",
		resideCity: "",
		graduateSchool: "",
		bio: "",
		interest: "",
		qq: "",
		site: "",
	};
}

/**
 * Create form data from user profile.
 * Pure function for testability.
 */
export function createFormDataFromUser(user: ProfileFormData): ProfileFormData {
	return {
		gender: user.gender,
		birthYear: user.birthYear,
		birthMonth: user.birthMonth,
		birthDay: user.birthDay,
		resideProvince: user.resideProvince,
		resideCity: user.resideCity,
		graduateSchool: user.graduateSchool,
		bio: user.bio,
		interest: user.interest,
		qq: user.qq,
		site: user.site,
	};
}

/**
 * Build the API payload from form data.
 * Pure function for testability.
 */
export function buildProfilePayload(form: ProfileFormData): ProfileFormData {
	return {
		gender: form.gender,
		birthYear: form.birthYear || 0,
		birthMonth: form.birthMonth || 0,
		birthDay: form.birthDay || 0,
		resideProvince: form.resideProvince,
		resideCity: form.resideCity,
		graduateSchool: form.graduateSchool,
		bio: form.bio,
		interest: form.interest,
		qq: form.qq,
		site: form.site,
	};
}

/**
 * Validate birth date components.
 * Pure function for testability.
 * Returns error message if invalid, null if valid.
 */
export function validateBirthDate(
	year: number,
	month: number,
	day: number,
): { valid: boolean; error?: string } {
	// All zeros is valid (not set)
	if (year === 0 && month === 0 && day === 0) {
		return { valid: true };
	}

	// If any is set, validate ranges
	if (year !== 0) {
		if (year < 1900 || year > 2100) {
			return { valid: false, error: "出生年份需在 1900-2100 之间" };
		}
	}

	if (month !== 0) {
		if (month < 1 || month > 12) {
			return { valid: false, error: "出生月份需在 1-12 之间" };
		}
	}

	if (day !== 0) {
		if (day < 1 || day > 31) {
			return { valid: false, error: "出生日期需在 1-31 之间" };
		}
	}

	return { valid: true };
}

/**
 * Submit profile update to API.
 * Extracted for testability.
 */
export async function submitProfileUpdate(form: ProfileFormData): Promise<void> {
	const payload = buildProfilePayload(form);
	await apiClient.patch<User>("/api/v1/users/me", payload);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * ViewModel hook for profile editing.
 * Encapsulates form state, validation, submission, and error handling.
 *
 * @example
 * ```tsx
 * const { state, actions } = useProfileEdit({
 *   initialData: user,
 *   open: dialogOpen,
 *   onSuccess: () => onOpenChange(false),
 * });
 *
 * return (
 *   <>
 *     <Select value={state.form.gender} onChange={(e) => actions.setField('gender', Number(e.target.value))} />
 *     {state.error && <Error>{state.error}</Error>}
 *     <Button onClick={actions.handleSave} disabled={state.submitting}>Save</Button>
 *   </>
 * );
 * ```
 */
export function useProfileEdit({
	initialData,
	open,
	onSuccess,
}: UseProfileEditOptions): UseProfileEditReturn {
	const router = useRouter();
	const toast = useForumToast();

	// State
	const [form, setForm] = useState<ProfileFormData>(() => createFormDataFromUser(initialData));
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Sync form when dialog opens or initial data changes
	useEffect(() => {
		if (open) {
			setForm(createFormDataFromUser(initialData));
			setError(null);
		}
	}, [open, initialData]);

	// Actions
	const setField = useCallback(
		<K extends keyof ProfileFormData>(field: K, value: ProfileFormData[K]) => {
			setForm((prev) => ({ ...prev, [field]: value }));
		},
		[],
	);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const resetForm = useCallback(() => {
		setForm(createFormDataFromUser(initialData));
		setError(null);
	}, [initialData]);

	const handleSave = useCallback(async () => {
		if (submitting) return;

		// Validate birth date
		const birthValidation = validateBirthDate(form.birthYear, form.birthMonth, form.birthDay);
		if (!birthValidation.valid) {
			setError(birthValidation.error ?? "生日格式有误");
			return;
		}

		setSubmitting(true);
		setError(null);

		try {
			await submitProfileUpdate(form);

			if (onSuccess) {
				onSuccess();
			}
			toast.success("个人资料已保存");
			router.refresh();
		} catch (err) {
			const code = err instanceof ApiError ? err.code : undefined;
			const message = getErrorMessage(code, "save");
			setError(message);
			toast.error({ title: "保存失败", description: message });
		} finally {
			setSubmitting(false);
		}
	}, [submitting, form, onSuccess, router, toast]);

	return {
		state: {
			submitting,
			error,
			form,
		},
		actions: {
			setField,
			handleSave,
			clearError,
			resetForm,
		},
	};
}
