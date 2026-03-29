"use client";

// viewmodels/forum/use-post-editor.ts — Post editor ViewModel hook
// Ref: 04d §PostEditor — React state wrapper around pure logic

import { createRepositories } from "@ellie/repositories";
import { useState } from "react";
import { type EditorMode, type SubmitResult, canSubmit, submitPost } from "./post-editor";

export interface UsePostEditorViewModel {
	content: string;
	setContent: (v: string) => void;
	subject: string;
	setSubject: (v: string) => void;
	submitting: boolean;
	submit: () => Promise<SubmitResult>;
	canSubmitNow: boolean;
}

export function usePostEditorViewModel(
	mode: EditorMode,
	targetId: number,
	authorId: number,
	authorName: string,
): UsePostEditorViewModel {
	const [content, setContent] = useState("");
	const [subject, setSubject] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const canSubmitNow = canSubmit(mode, subject, content);

	const submit = async (): Promise<SubmitResult> => {
		setSubmitting(true);
		try {
			const repos = createRepositories();
			return await submitPost(repos, mode, targetId, subject, content, authorId, authorName);
		} finally {
			setSubmitting(false);
		}
	};

	return {
		content,
		setContent,
		subject,
		setSubject,
		submitting,
		submit,
		canSubmitNow,
	};
}
