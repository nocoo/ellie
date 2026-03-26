// (admin)/layout.tsx — Admin Route Group layout with auth guard
// Ref: 04c §权限守卫 — page-level auth check

import type { ReactNode } from "react";

/**
 * Admin layout wraps all /admin/* pages.
 *
 * Phase 2: This layout will call auth() and redirect non-admin users.
 * Mock phase: Simple pass-through (auth is simulated at ViewModel level).
 */
export default function AdminGroupLayout({ children }: { children: ReactNode }) {
	// Phase 2: const session = await auth(); redirect if !canAccessAdmin
	return <>{children}</>;
}
