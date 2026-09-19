/** Pure pagination settings projection; shared I/O lives in forum-cache.ts. */

import "server-only";

import type { SettingsMap } from "./public-settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumSettings {
	pageSize: number;
	postsPerPage: number;
	maxPostLength: number;
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

export function parseForumSettings(data: SettingsMap): ForumSettings {
	return {
		pageSize: parseNumber(data["general.pagination.page_size"], DEFAULT_PAGE_SIZE),
		postsPerPage: parseNumber(data["general.pagination.posts_per_page"], DEFAULT_POSTS_PER_PAGE),
		maxPostLength: parseNumber(data["general.pagination.max_post_length"], DEFAULT_MAX_POST_LENGTH),
	};
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
