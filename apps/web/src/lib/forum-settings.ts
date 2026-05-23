/**
 * Server-only forum settings loader (unwrapped).
 *
 * Phase B: this file is pure-loader / pure-helpers only. RSC render-pass
 * dedupe and the `getCachedPageSize` / `getCachedPostsPerPage`
 * convenience wrappers live in `lib/forum-cache.ts`. Do not import React
 * `cache()` here — the static guard
 * (`tests/unit/architecture/no-adhoc-cache.test.ts`) forbids it.
 */

import "server-only";

import { forumApi } from "./forum-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumSettings {
	pageSize: number;
	postsPerPage: number;
	maxPostLength: number;
}

interface SettingsResponse {
	[key: string]: string | number | boolean | object;
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_POSTS_PER_PAGE = 20;
const DEFAULT_MAX_POST_LENGTH = 50000;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Fetch forum settings from the Worker API. Falls back to defaults on
 * any error. Pure async; no in-process cache here.
 */
export async function fetchForumSettings(): Promise<ForumSettings> {
	try {
		const { data } = await forumApi.get<SettingsResponse>("/api/v1/settings", { revalidate: 60 });

		return {
			pageSize: parseNumber(data["general.pagination.page_size"], DEFAULT_PAGE_SIZE),
			postsPerPage: parseNumber(data["general.pagination.posts_per_page"], DEFAULT_POSTS_PER_PAGE),
			maxPostLength: parseNumber(
				data["general.pagination.max_post_length"],
				DEFAULT_MAX_POST_LENGTH,
			),
		};
	} catch {
		return {
			pageSize: DEFAULT_PAGE_SIZE,
			postsPerPage: DEFAULT_POSTS_PER_PAGE,
			maxPostLength: DEFAULT_MAX_POST_LENGTH,
		};
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumber(value: unknown, defaultValue: number): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const n = Number.parseInt(value, 10);
		return Number.isNaN(n) ? defaultValue : n;
	}
	return defaultValue;
}
