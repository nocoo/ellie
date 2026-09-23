"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { getAvatarUrl } from "@/lib/avatar";

interface AvatarContextValue {
	avatars: Record<number, string>;
	updateAvatar: (uid: number, url: string) => void;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
	const [avatars, setAvatars] = useState<Record<number, string>>({});
	const updateAvatar = useCallback((uid: number, url: string) => {
		setAvatars((prev) => ({ ...prev, [uid]: url }));
	}, []);
	const value = useMemo(() => ({ avatars, updateAvatar }), [avatars, updateAvatar]);
	return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useAvatarContext() {
	const context = useContext(AvatarContext);
	if (!context) throw new Error("useAvatarContext must be used within an AvatarProvider");
	return context;
}

export function useAvatarUrl(uid: number, avatarPath?: string): string {
	const context = useContext(AvatarContext);
	return context?.avatars[uid] ?? getAvatarUrl(uid, "big", avatarPath);
}
