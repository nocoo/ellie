"use client";

// MaintenanceGuard — shows maintenance page when maintenance mode is enabled
// Allows admin paths to bypass maintenance check

import { usePathname } from "next/navigation";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { MaintenancePage } from "./maintenance-page";

const ALLOWED_PATHS = ["/admin", "/api", "/login", "/_next"];

interface MaintenanceGuardProps {
	children: React.ReactNode;
}

export function MaintenanceGuard({ children }: MaintenanceGuardProps) {
	const { isMaintenanceMode, maintenanceMessage, isLoading } = useFeatureFlags();
	const pathname = usePathname();

	const isAllowedPath = ALLOWED_PATHS.some((path) => pathname?.startsWith(path));

	// Don't block while loading to avoid flash
	if (isLoading) return <>{children}</>;

	if (isMaintenanceMode && !isAllowedPath) {
		return <MaintenancePage message={maintenanceMessage} />;
	}

	return <>{children}</>;
}
