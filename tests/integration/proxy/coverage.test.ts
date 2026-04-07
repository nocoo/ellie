// tests/integration/proxy/coverage.test.ts — L2 Proxy Coverage Tests
// Verifies that all browser-needed Worker endpoints have corresponding Next.js proxy routes

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Browser-callable endpoints that need Next.js proxy routes.
 * These are endpoints that:
 * 1. Are called directly from browser JavaScript (not SSR)
 * 2. Require authentication (JWT) which is handled client-side
 */
const BROWSER_ENDPOINTS = [
	// User self-service
	{ method: "GET", path: "/api/v1/users/[id]", file: "v1/users/[id]/route.ts" },
	{ method: "PATCH", path: "/api/v1/users/me", file: "v1/users/me/route.ts" },
	{ method: "GET", path: "/api/v1/users/search", file: "v1/users/search/route.ts" },

	// User content management
	{ method: "DELETE", path: "/api/v1/me/posts/[id]", file: "v1/me/posts/[id]/route.ts" },
	{ method: "DELETE", path: "/api/v1/me/threads/[id]", file: "v1/me/threads/[id]/route.ts" },
	{ method: "PATCH", path: "/api/v1/me/posts/[id]", file: "v1/me/posts/[id]/route.ts" },

	// Thread creation (browser form submit)
	{ method: "POST", path: "/api/v1/threads", file: "v1/threads/route.ts" },

	// Post creation (browser form submit)
	{ method: "POST", path: "/api/v1/posts", file: "v1/posts/route.ts" },

	// Post attachments
	{
		method: "GET",
		path: "/api/v1/posts/[id]/attachments",
		file: "v1/posts/[id]/attachments/route.ts",
	},

	// Password change
	{ method: "POST", path: "/api/v1/users/me/password", file: "v1/users/me/password/route.ts" },

	// Settings (feature flags)
	{ method: "GET", path: "/api/v1/settings", file: "v1/settings/route.ts" },

	// Messages
	{ method: "GET", path: "/api/v1/messages", file: "v1/messages/route.ts" },
	{ method: "POST", path: "/api/v1/messages", file: "v1/messages/route.ts" },
	{ method: "GET", path: "/api/v1/messages/[id]", file: "v1/messages/[id]/route.ts" },
	{ method: "DELETE", path: "/api/v1/messages/[id]", file: "v1/messages/[id]/route.ts" },
	{
		method: "GET",
		path: "/api/v1/messages/unread-count",
		file: "v1/messages/unread-count/route.ts",
	},
	{
		method: "POST",
		path: "/api/v1/messages/mark-all-read",
		file: "v1/messages/mark-all-read/route.ts",
	},

	// Moderation - Thread actions
	{
		method: "PATCH",
		path: "/api/v1/moderation/threads/[id]/sticky",
		file: "v1/moderation/threads/[id]/sticky/route.ts",
	},
	{
		method: "PATCH",
		path: "/api/v1/moderation/threads/[id]/digest",
		file: "v1/moderation/threads/[id]/digest/route.ts",
	},
	{
		method: "PATCH",
		path: "/api/v1/moderation/threads/[id]/close",
		file: "v1/moderation/threads/[id]/close/route.ts",
	},
	{
		method: "PATCH",
		path: "/api/v1/moderation/threads/[id]/move",
		file: "v1/moderation/threads/[id]/move/route.ts",
	},
	{
		method: "PATCH",
		path: "/api/v1/moderation/threads/[id]/highlight",
		file: "v1/moderation/threads/[id]/highlight/route.ts",
	},
	{
		method: "DELETE",
		path: "/api/v1/moderation/threads/[id]",
		file: "v1/moderation/threads/[id]/route.ts",
	},

	// Moderation - Post actions
	{
		method: "DELETE",
		path: "/api/v1/moderation/posts/[id]",
		file: "v1/moderation/posts/[id]/route.ts",
	},
	{
		method: "PATCH",
		path: "/api/v1/moderation/posts/[id]",
		file: "v1/moderation/posts/[id]/route.ts",
	},

	// Moderation - User actions
	{
		method: "GET",
		path: "/api/v1/moderation/users/[id]/status",
		file: "v1/moderation/users/[id]/status/route.ts",
	},
	{
		method: "GET",
		path: "/api/v1/moderation/users/[id]/ip-records",
		file: "v1/moderation/users/[id]/ip-records/route.ts",
	},
	{
		method: "POST",
		path: "/api/v1/moderation/users/[id]/mute",
		file: "v1/moderation/users/[id]/mute/route.ts",
	},
	{
		method: "POST",
		path: "/api/v1/moderation/users/[id]/unmute",
		file: "v1/moderation/users/[id]/unmute/route.ts",
	},
	{
		method: "POST",
		path: "/api/v1/moderation/users/[id]/ban",
		file: "v1/moderation/users/[id]/ban/route.ts",
	},
	{
		method: "POST",
		path: "/api/v1/moderation/users/[id]/unban",
		file: "v1/moderation/users/[id]/unban/route.ts",
	},
	{
		method: "POST",
		path: "/api/v1/moderation/users/[id]/nuke",
		file: "v1/moderation/users/[id]/nuke/route.ts",
	},
] as const;

/**
 * Admin endpoints that need Next.js proxy routes.
 * All admin routes use Key B and are called from the admin dashboard.
 */
const ADMIN_ENDPOINTS = [
	// Forums
	{ method: "GET", path: "/api/admin/forums", file: "admin/forums/route.ts" },
	{ method: "POST", path: "/api/admin/forums", file: "admin/forums/route.ts" },
	{ method: "GET", path: "/api/admin/forums/[id]", file: "admin/forums/[id]/route.ts" },
	{ method: "PATCH", path: "/api/admin/forums/[id]", file: "admin/forums/[id]/route.ts" },
	{ method: "DELETE", path: "/api/admin/forums/[id]", file: "admin/forums/[id]/route.ts" },
	{ method: "POST", path: "/api/admin/forums/reorder", file: "admin/forums/reorder/route.ts" },
	{
		method: "POST",
		path: "/api/admin/forums/[id]/merge",
		file: "admin/forums/[id]/merge/route.ts",
	},

	// Threads
	{ method: "GET", path: "/api/admin/threads", file: "admin/threads/route.ts" },
	{ method: "GET", path: "/api/admin/threads/[id]", file: "admin/threads/[id]/route.ts" },
	{ method: "PATCH", path: "/api/admin/threads/[id]", file: "admin/threads/[id]/route.ts" },
	{ method: "DELETE", path: "/api/admin/threads/[id]", file: "admin/threads/[id]/route.ts" },
	{
		method: "POST",
		path: "/api/admin/threads/batch-delete",
		file: "admin/threads/batch-delete/route.ts",
	},
	{
		method: "POST",
		path: "/api/admin/threads/batch-move",
		file: "admin/threads/batch-move/route.ts",
	},

	// Posts
	{ method: "GET", path: "/api/admin/posts", file: "admin/posts/route.ts" },
	{ method: "GET", path: "/api/admin/posts/[id]", file: "admin/posts/[id]/route.ts" },
	{ method: "PATCH", path: "/api/admin/posts/[id]", file: "admin/posts/[id]/route.ts" },
	{ method: "DELETE", path: "/api/admin/posts/[id]", file: "admin/posts/[id]/route.ts" },
	{
		method: "POST",
		path: "/api/admin/posts/batch-delete",
		file: "admin/posts/batch-delete/route.ts",
	},

	// Users
	{ method: "GET", path: "/api/admin/users", file: "admin/users/route.ts" },
	{ method: "GET", path: "/api/admin/users/staff", file: "admin/users/staff/route.ts" },
	{ method: "GET", path: "/api/admin/users/batch", file: "admin/users/batch/route.ts" },
	{ method: "GET", path: "/api/admin/users/[id]", file: "admin/users/[id]/route.ts" },
	{ method: "PATCH", path: "/api/admin/users/[id]", file: "admin/users/[id]/route.ts" },
	{ method: "POST", path: "/api/admin/users/[id]/ban", file: "admin/users/[id]/ban/route.ts" },
	{ method: "POST", path: "/api/admin/users/[id]/nuke", file: "admin/users/[id]/nuke/route.ts" },
	{
		method: "POST",
		path: "/api/admin/users/[id]/recalc-counters",
		file: "admin/users/[id]/recalc-counters/route.ts",
	},
	{
		method: "POST",
		path: "/api/admin/users/batch-status",
		file: "admin/users/batch-status/route.ts",
	},
	{ method: "POST", path: "/api/admin/users/batch-role", file: "admin/users/batch-role/route.ts" },
	{
		method: "POST",
		path: "/api/admin/users/batch-recalc-counters",
		file: "admin/users/batch-recalc-counters/route.ts",
	},

	// Statistics
	{
		method: "POST",
		path: "/api/admin/statistics/recalc-forums",
		file: "admin/statistics/recalc-forums/route.ts",
	},
	{
		method: "POST",
		path: "/api/admin/statistics/recalc-threads",
		file: "admin/statistics/recalc-threads/route.ts",
	},
	{
		method: "POST",
		path: "/api/admin/statistics/recalc-users",
		file: "admin/statistics/recalc-users/route.ts",
	},

	// Attachments
	{ method: "GET", path: "/api/admin/attachments", file: "admin/attachments/route.ts" },
	{ method: "GET", path: "/api/admin/attachments/[id]", file: "admin/attachments/[id]/route.ts" },
	{
		method: "DELETE",
		path: "/api/admin/attachments/[id]",
		file: "admin/attachments/[id]/route.ts",
	},
	{
		method: "POST",
		path: "/api/admin/attachments/batch-delete",
		file: "admin/attachments/batch-delete/route.ts",
	},

	// IP Bans
	{ method: "GET", path: "/api/admin/ip-bans", file: "admin/ip-bans/route.ts" },
	{ method: "POST", path: "/api/admin/ip-bans", file: "admin/ip-bans/route.ts" },
	{ method: "GET", path: "/api/admin/ip-bans/check-ip", file: "admin/ip-bans/check-ip/route.ts" },
	{ method: "GET", path: "/api/admin/ip-bans/[id]", file: "admin/ip-bans/[id]/route.ts" },
	{ method: "PATCH", path: "/api/admin/ip-bans/[id]", file: "admin/ip-bans/[id]/route.ts" },
	{ method: "DELETE", path: "/api/admin/ip-bans/[id]", file: "admin/ip-bans/[id]/route.ts" },
	{
		method: "POST",
		path: "/api/admin/ip-bans/batch-delete",
		file: "admin/ip-bans/batch-delete/route.ts",
	},

	// Censor Words
	{ method: "GET", path: "/api/admin/censor-words", file: "admin/censor-words/route.ts" },
	{ method: "POST", path: "/api/admin/censor-words", file: "admin/censor-words/route.ts" },
	{
		method: "POST",
		path: "/api/admin/censor-words/test",
		file: "admin/censor-words/test/route.ts",
	},
	{ method: "GET", path: "/api/admin/censor-words/[id]", file: "admin/censor-words/[id]/route.ts" },
	{
		method: "PATCH",
		path: "/api/admin/censor-words/[id]",
		file: "admin/censor-words/[id]/route.ts",
	},
	{
		method: "DELETE",
		path: "/api/admin/censor-words/[id]",
		file: "admin/censor-words/[id]/route.ts",
	},
	{
		method: "POST",
		path: "/api/admin/censor-words/batch-delete",
		file: "admin/censor-words/batch-delete/route.ts",
	},

	// Admin Stats & Settings
	{ method: "GET", path: "/api/admin/stats", file: "admin/stats/route.ts" },
	{ method: "GET", path: "/api/admin/settings", file: "admin/settings/route.ts" },
	{ method: "PUT", path: "/api/admin/settings", file: "admin/settings/route.ts" },

	// Reports
	{ method: "GET", path: "/api/admin/reports", file: "admin/reports/route.ts" },
	{ method: "GET", path: "/api/admin/reports/[id]", file: "admin/reports/[id]/route.ts" },
	{ method: "PATCH", path: "/api/admin/reports/[id]", file: "admin/reports/[id]/route.ts" },
	{
		method: "POST",
		path: "/api/admin/reports/batch-delete",
		file: "admin/reports/batch-delete/route.ts",
	},

	// Admin Logs
	{ method: "GET", path: "/api/admin/admin-logs", file: "admin/admin-logs/route.ts" },
	{ method: "GET", path: "/api/admin/admin-logs/[id]", file: "admin/admin-logs/[id]/route.ts" },

	// Announcements
	{ method: "GET", path: "/api/admin/announcements", file: "admin/announcements/route.ts" },
	{ method: "POST", path: "/api/admin/announcements", file: "admin/announcements/route.ts" },
	{
		method: "GET",
		path: "/api/admin/announcements/[id]",
		file: "admin/announcements/[id]/route.ts",
	},
	{
		method: "PATCH",
		path: "/api/admin/announcements/[id]",
		file: "admin/announcements/[id]/route.ts",
	},
	{
		method: "DELETE",
		path: "/api/admin/announcements/[id]",
		file: "admin/announcements/[id]/route.ts",
	},
	{
		method: "POST",
		path: "/api/admin/announcements/batch-delete",
		file: "admin/announcements/batch-delete/route.ts",
	},
] as const;

const API_ROUTES_DIR = resolve(process.cwd(), "apps/web/src/app/api");
const ADMIN_ROUTES_DIR = resolve(process.cwd(), "apps/admin/src/app/api");

describe("L2: Proxy Coverage — Browser Endpoints", () => {
	// Group tests by unique file to avoid duplicate checks
	const uniqueFiles = new Map<string, { methods: string[]; path: string }>();
	for (const ep of BROWSER_ENDPOINTS) {
		const existing = uniqueFiles.get(ep.file);
		if (existing) {
			existing.methods.push(ep.method);
		} else {
			uniqueFiles.set(ep.file, { methods: [ep.method], path: ep.path });
		}
	}

	for (const [file, { methods, path }] of uniqueFiles) {
		test(`${methods.join("/")} ${path} → ${file} exists`, () => {
			const fullPath = resolve(API_ROUTES_DIR, file);
			expect(existsSync(fullPath)).toBe(true);
		});
	}
});

describe("L2: Proxy Coverage — Admin Endpoints", () => {
	// Group tests by unique file
	const uniqueFiles = new Map<string, { methods: string[]; path: string }>();
	for (const ep of ADMIN_ENDPOINTS) {
		const existing = uniqueFiles.get(ep.file);
		if (existing) {
			existing.methods.push(ep.method);
		} else {
			uniqueFiles.set(ep.file, { methods: [ep.method], path: ep.path });
		}
	}

	for (const [file, { methods, path }] of uniqueFiles) {
		test(`${methods.join("/")} ${path} → ${file} exists`, () => {
			const fullPath = resolve(ADMIN_ROUTES_DIR, file);
			expect(existsSync(fullPath)).toBe(true);
		});
	}
});

describe("L2: Proxy Coverage Summary", () => {
	test("all browser endpoints have proxy routes", () => {
		const missing: string[] = [];
		for (const ep of BROWSER_ENDPOINTS) {
			const fullPath = resolve(API_ROUTES_DIR, ep.file);
			if (!existsSync(fullPath)) {
				missing.push(`${ep.method} ${ep.path}`);
			}
		}
		if (missing.length > 0) {
			console.log("Missing browser proxy routes:", missing);
		}
		expect(missing).toEqual([]);
	});

	test("all admin endpoints have proxy routes", () => {
		const missing: string[] = [];
		for (const ep of ADMIN_ENDPOINTS) {
			const fullPath = resolve(ADMIN_ROUTES_DIR, ep.file);
			if (!existsSync(fullPath)) {
				missing.push(`${ep.method} ${ep.path}`);
			}
		}
		if (missing.length > 0) {
			console.log("Missing admin proxy routes:", missing);
		}
		expect(missing).toEqual([]);
	});
});
