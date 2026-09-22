"use client";

import { SessionContext } from "next-auth/react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

export interface ComposerDraft {
	content: string;
	subject: string;
	typeId: number | null;
}

export type DraftStatus = "empty" | "saved" | "restored" | "unavailable";

const EMPTY_DRAFT: ComposerDraft = { content: "", subject: "", typeId: null };

function parseDraft(value: string | null): ComposerDraft | null {
	if (!value) return null;
	const draft: unknown = JSON.parse(value);
	if (
		!draft ||
		typeof draft !== "object" ||
		!("content" in draft) ||
		typeof draft.content !== "string" ||
		!("subject" in draft) ||
		typeof draft.subject !== "string" ||
		!("typeId" in draft) ||
		(draft.typeId !== null &&
			(typeof draft.typeId !== "number" ||
				!Number.isSafeInteger(draft.typeId) ||
				draft.typeId <= 0))
	) {
		return null;
	}
	return { content: draft.content, subject: draft.subject, typeId: draft.typeId };
}

export function useComposerDraft(scope: string, initial: ComposerDraft = EMPTY_DRAFT) {
	const session = useContext(SessionContext);
	const userId = session?.data?.user?.id;
	const storageKey = userId ? `ellie:composer:${userId}:${scope}` : null;
	const identity = storageKey ?? `memory:${scope}`;
	const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
	const [draft, setDraft] = useState(initial);
	const [status, setStatus] = useState<DraftStatus>("empty");
	const current = useRef(initial);
	const initialRef = useRef(initial);
	initialRef.current = initial;

	useEffect(() => {
		let next = { content: initial.content, subject: initial.subject, typeId: initial.typeId };
		let nextStatus: DraftStatus = "empty";
		if (storageKey) {
			try {
				const saved = parseDraft(sessionStorage.getItem(storageKey));
				if (saved) {
					next = saved;
					nextStatus = "restored";
				}
			} catch {
				nextStatus = "unavailable";
			}
		}
		current.current = next;
		setDraft(next);
		setStatus(nextStatus);
		setLoadedIdentity(identity);
	}, [storageKey, identity, initial.content, initial.subject, initial.typeId]);

	const update = useCallback(
		(patch: Partial<ComposerDraft>) => {
			const next = { ...current.current, ...patch };
			current.current = next;
			setDraft(next);
			if (!storageKey) return;
			try {
				sessionStorage.setItem(storageKey, JSON.stringify(next));
				setStatus("saved");
			} catch {
				setStatus("unavailable");
			}
		},
		[storageKey],
	);

	const clear = useCallback(() => {
		current.current = initialRef.current;
		setDraft(initialRef.current);
		setStatus("empty");
		if (!storageKey) return;
		try {
			sessionStorage.removeItem(storageKey);
		} catch {
			setStatus("unavailable");
		}
	}, [storageKey]);

	return {
		draft,
		status,
		ready: loadedIdentity === identity && session?.status !== "loading",
		update,
		clear,
	};
}
