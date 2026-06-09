"use client";

// useFeatureFlags — access feature flags from settings API
// Used by components to check posting permissions and maintenance mode
//
// Phase B: in-process caching now goes through `lib/ttl-cache`. Tests
// reset state via the exported `featureFlagsCache.clear()`.

import { useEffect, useState } from "react";
import { fetchFeatureFlags } from "@/lib/forum-browser-api";
import { createTtlCache } from "@/lib/ttl-cache";

// Feature defaults for forum (subset of all feature flags)
const FEATURE_DEFAULTS: Record<string, string> = {
	"features.content.allow_new_thread": "true",
	"features.content.allow_reply": "true",
	"features.access.maintenance_mode": "false",
	"features.access.maintenance_message": "系统正在维护中，请稍后再试",
	"features.access.require_login": "false",
};

interface FeatureFlags {
	canCreateThread: boolean;
	canReply: boolean;
	isMaintenanceMode: boolean;
	maintenanceMessage: string;
	requireLogin: boolean;
	isLoading: boolean;
}

type FeatureFlagData = Record<string, string | number | boolean>;

/**
 * In-memory feature-flag cache (1 minute TTL with concurrency dedupe).
 * Exported so tests can call `featureFlagsCache.clear()` between cases.
 */
export const featureFlagsCache = createTtlCache<FeatureFlagData>({
	expirationMs: 60_000,
	load: (_key, opts) => fetchFeatureFlags({ signal: opts?.signal }),
});

export function useFeatureFlags(): FeatureFlags {
	// Seed from the synchronous TTL peek so a cache hit doesn't show a
	// loading frame on second mount. Falls through to the effect below
	// when the cache is cold or expired.
	const initial = featureFlagsCache.peek();
	const [data, setData] = useState<FeatureFlagData | null>(initial ?? null);
	const [isLoading, setIsLoading] = useState(initial === undefined);

	useEffect(() => {
		const controller = new AbortController();

		featureFlagsCache
			.get(undefined, { signal: controller.signal })
			.then((result) => {
				setData(result);
				setIsLoading(false);
			})
			.catch((err) => {
				if (err?.name !== "AbortError") {
					console.error("Failed to fetch feature flags:", err);
					setIsLoading(false);
				}
			});

		return () => controller.abort();
	}, []);

	const getValue = (key: string): string => {
		const val = data?.[key];
		if (val === undefined || val === null) {
			return FEATURE_DEFAULTS[key] ?? "";
		}
		return String(val);
	};

	return {
		canCreateThread: getValue("features.content.allow_new_thread") !== "false",
		canReply: getValue("features.content.allow_reply") !== "false",
		isMaintenanceMode: getValue("features.access.maintenance_mode") === "true",
		maintenanceMessage: getValue("features.access.maintenance_message"),
		requireLogin: getValue("features.access.require_login") === "true",
		isLoading,
	};
}
