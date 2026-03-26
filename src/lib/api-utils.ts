// lib/api-utils.ts — Shared API route utilities
// Ref: 04b §API 路由边界 — common helpers for route handlers

import { type Repositories, createRepositories } from "@/data/index";
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
 * Phase 2: may add request-scoped caching.
 */
export function getRepos(): Repositories {
	return createRepositories();
}
