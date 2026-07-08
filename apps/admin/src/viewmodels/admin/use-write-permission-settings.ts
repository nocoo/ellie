"use client";

// use-write-permission-settings.ts — shared hook that pulls the five
// posting/content settings needed by evaluateWritePermission(). Extracted
// from user-write-permission-card so the users list page can consume the
// same fetch without re-implementing the shape converter.
//
// A single feature-settings fetch per mount is enough — the values change
// via the admin settings page (which reloads on save) and rate-of-change
// is measured in days, not minutes.

import { useEffect, useState } from "react";
import { FEATURE_DEFAULTS, fetchFeatureSettings } from "@/viewmodels/admin/features";
import type { WritePermissionSettings } from "@/viewmodels/admin/write-permission";

export interface WritePermissionSettingsState {
	settings: WritePermissionSettings;
	loading: boolean;
	error: string | null;
}

/**
 * Project the raw settings map into the shape evaluateWritePermission wants,
 * applying FEATURE_DEFAULTS as fallbacks. Extracted so both the runtime
 * fetch path and any future SSR/hard-coded caller share one converter.
 */
export function settingsFromMap(map: Record<string, string>): WritePermissionSettings {
	const resolve = (key: string): string => map[key] ?? FEATURE_DEFAULTS[key] ?? "";
	return {
		allowNewThread: resolve("features.content.allow_new_thread") !== "false",
		allowReply: resolve("features.content.allow_reply") !== "false",
		postingRestrictionsEnabled: resolve("features.posting.enabled") === "true",
		minRegistrationDays: Number.parseInt(resolve("features.posting.min_registration_days"), 10),
		requireAvatar: resolve("features.posting.require_avatar") === "true",
	};
}

export function useWritePermissionSettings(): WritePermissionSettingsState {
	const [state, setState] = useState<WritePermissionSettingsState>(() => ({
		settings: settingsFromMap({}),
		loading: true,
		error: null,
	}));

	useEffect(() => {
		let cancelled = false;
		fetchFeatureSettings()
			.then((res) => {
				if (cancelled) return;
				const flat: Record<string, string> = {};
				for (const [k, v] of Object.entries(res)) flat[k] = v.value;
				setState({ settings: settingsFromMap(flat), loading: false, error: null });
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				// Silent fallback — callers still render using defaults so
				// operators are never blocked. Surfacing the error as a
				// small hint keeps them aware if the values might be stale.
				setState({
					settings: settingsFromMap({}),
					loading: false,
					error: err instanceof Error ? err.message : "settings 读取失败，使用默认值",
				});
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return state;
}
