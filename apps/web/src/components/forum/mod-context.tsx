"use client";

// components/forum/mod-context.tsx — Moderation permission context
// Server computes canModerate, then passes to client components via this context.

import { type ReactNode, createContext, useContext } from "react";

export interface ModContextValue {
	/** Can current user moderate this forum */
	canModerate: boolean;
	/** Forum ID for the current thread */
	forumId: number;
	/** Thread ID for the current page */
	threadId: number;
}

const ModContext = createContext<ModContextValue | null>(null);

interface ModProviderProps extends ModContextValue {
	children: ReactNode;
}

export function ModProvider({ children, canModerate, forumId, threadId }: ModProviderProps) {
	return (
		<ModContext.Provider value={{ canModerate, forumId, threadId }}>{children}</ModContext.Provider>
	);
}

/**
 * Access moderation context. Returns null when not inside a ModProvider.
 */
export function useModContext(): ModContextValue | null {
	return useContext(ModContext);
}
