// (admin)/layout.tsx — Admin Route Group layout with auth guard
// Ref: 04c §权限守卫 — page-level auth check
//
// MOCK PHASE: This layout is a pass-through. Auth enforcement happens at
// the proxy level (src/proxy.ts) via X-Mock-Uid/X-Mock-Role headers.
// Phase 2: This layout will call auth() and redirect non-admin users
// to /login, providing a server-side fallback guard.

import type { ReactNode } from "react";

/**
 * Admin layout wraps all /admin/* pages.
 * Auth is enforced at proxy level (proxy.ts checks X-Mock-Role ∈ {1,2}).
 * This layout serves as a secondary guard for Phase 2 when NextAuth is used.
 */
export default function AdminGroupLayout({ children }: { children: ReactNode }) {
	// Phase 2: const session = await auth(); redirect if !canAccessAdmin(session)
	return <>{children}</>;
}
