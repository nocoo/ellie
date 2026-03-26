// lib/api-utils.ts — Shared API route utilities
// Ref: 04b §API 路由边界 — common helpers for route handlers

import { type Repositories, createRepositories } from "@/data/index";
import { UserRole } from "@/models/types";
import { NextResponse } from "next/server";

/**
 * Parse a numeric ID from a route param string.
 * Returns the number or a 400 error response.
 */
export function parseId(id: string, label = "ID"): { value: number } | { error: NextResponse } {
	const value = Number(id);
	if (Number.isNaN(value) || value <= 0) {
		return { error: NextResponse.json({ error: `Invalid ${label}` }, { status: 400 }) };
	}
	return { value };
}

/**
 * Create a JSON error response.
 */
export function errorResponse(message: string, status: number): NextResponse {
	return NextResponse.json({ error: message }, { status });
}

/**
 * Create repositories instance.
 * Uses the module-level singleton store — all requests share state.
 * Phase 2: may add request-scoped caching on top of D1 repos.
 */
export function getRepos(): Repositories {
	return createRepositories();
}

// ---------------------------------------------------------------------------
// Role-based access control
// ---------------------------------------------------------------------------

/** Roles that can perform moderation actions (Admin, SuperMod, Mod) */
const MOD_ROLES = new Set([UserRole.Admin, UserRole.SuperMod, UserRole.Mod]);

/** Roles that can access admin panel (Admin, SuperMod) */
const ADMIN_ROLES = new Set([UserRole.Admin, UserRole.SuperMod]);

/**
 * Check if a role has moderation privileges.
 * Pure function, exported for testing.
 */
export function isModRole(role: number): boolean {
	return MOD_ROLES.has(role as UserRole);
}

/**
 * Check if a role has admin privileges.
 * Pure function, exported for testing.
 */
export function isAdminRole(role: number): boolean {
	return ADMIN_ROLES.has(role as UserRole);
}

/**
 * Extract mock user role from request headers.
 *
 * Phase 2: will use NextAuth session/JWT.
 * Mock phase: reads X-Mock-Role header for testing.
 */
export function getMockUserRole(request: Request): number | null {
	const roleHeader = request.headers.get("X-Mock-Role");
	if (roleHeader === null) return null;
	const role = Number(roleHeader);
	if (Number.isNaN(role)) return null;
	return role;
}
