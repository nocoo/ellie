"use client";

// useFeatureFlags — access feature flags from settings API
// Used by components to check posting permissions and maintenance mode

import { FEATURE_DEFAULTS } from "@/viewmodels/admin/features";
import { useEffect, useState } from "react";

interface FeatureFlags {
	canCreateThread: boolean;
	canReply: boolean;
	isMaintenanceMode: boolean;
	maintenanceMessage: string;
	requireLogin: boolean;
	isLoading: boolean;
}

// Simple in-memory cache
let cachedData: Record<string, string | number | boolean> | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 60000; // 1 minute

export function useFeatureFlags(): FeatureFlags {
	const [data, setData] = useState<Record<string, string | number | boolean> | null>(cachedData);
	const [isLoading, setIsLoading] = useState(cachedData === null);

	useEffect(() => {
		// Skip if cache is still valid
		if (cachedData && Date.now() < cacheExpiry) {
			setData(cachedData);
			setIsLoading(false);
			return;
		}

		const controller = new AbortController();

		fetch("/api/v1/settings?prefix=features.", { signal: controller.signal })
			.then((r) => r.json())
			.then((result) => {
				cachedData = result;
				cacheExpiry = Date.now() + CACHE_TTL;
				setData(result);
				setIsLoading(false);
			})
			.catch((err) => {
				if (err.name !== "AbortError") {
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
