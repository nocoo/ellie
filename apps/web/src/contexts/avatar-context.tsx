"use client";

// Avatar Context — propagates cache-bust version for avatar updates
// When a user uploads a new avatar, all avatar components using this context
// will immediately update to show the new image.

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

interface AvatarVersionMap {
	[uid: number]: number; // uid -> timestamp for cache busting
}

interface AvatarContextValue {
	/** Get the current version timestamp for a user's avatar */
	getVersion: (uid: number) => number | undefined;
	/** Update the version for a user's avatar (triggers re-render for all components using that avatar) */
	updateVersion: (uid: number, version?: number) => void;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
	const [versions, setVersions] = useState<AvatarVersionMap>({});

	const getVersion = useCallback((uid: number) => versions[uid], [versions]);

	const updateVersion = useCallback((uid: number, version?: number) => {
		setVersions((prev) => ({
			...prev,
			[uid]: version ?? Date.now(),
		}));
	}, []);

	const value = useMemo(() => ({ getVersion, updateVersion }), [getVersion, updateVersion]);

	return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

/**
 * Hook to access avatar version context.
 * Must be used within an AvatarProvider.
 */
export function useAvatarVersion() {
	const context = useContext(AvatarContext);
	if (!context) {
		throw new Error("useAvatarVersion must be used within an AvatarProvider");
	}
	return context;
}

/**
 * Hook to get a single user's avatar URL with automatic version tracking.
 * Re-renders when that user's avatar version changes.
 */
export function useAvatarUrl(uid: number): string {
	const { getVersion } = useAvatarVersion();
	const version = getVersion(uid);
	const params = version ? `?v=${version}` : "";
	return `/api/avatar/${uid}${params}`;
}
