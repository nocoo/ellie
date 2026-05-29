// lib/stats-counter.ts — Increment pre-computed stats counters
// These counters are stored in settings table and KV for fast reads.
// Manual calibration is available in admin panel.

import type { Env } from "./env";

/**
 * Increment a settings-based counter by 1.
 * Uses UPDATE SET value = CAST(value AS INTEGER) + 1 for atomic increment.
 */
async function incrementSettingsCounter(env: Env, key: string): Promise<void> {
	await env.DB.prepare(
		"UPDATE settings SET value = CAST(value AS INTEGER) + 1, updated_at = ? WHERE key = ?",
	)
		.bind(Math.floor(Date.now() / 1000), key)
		.run();
}

/**
 * Increment the today's posts counter in KV.
 * KV get→put is not atomic, so slight undercounting is possible under high concurrency.
 * This is acceptable since admin can calibrate.
 */
async function incrementTodayPosts(env: Env): Promise<void> {
	const current = await env.KV.get("stats:today_posts");
	const newValue = (current ? Number.parseInt(current, 10) : 0) + 1;
	await env.KV.put("stats:today_posts", String(newValue), { expirationTtl: 86_400 });
}

/**
 * Called when a new thread is created.
 * Increments: total_threads, total_posts (first post), today_posts
 */
export async function incrementStatsOnThreadCreate(env: Env): Promise<void> {
	await Promise.all([
		incrementSettingsCounter(env, "stats.total_threads"),
		incrementSettingsCounter(env, "stats.total_posts"),
		incrementTodayPosts(env),
	]);
}

/**
 * Called when a new reply is created (not first post).
 * Increments: total_posts, today_posts
 */
export async function incrementStatsOnPostCreate(env: Env): Promise<void> {
	await Promise.all([incrementSettingsCounter(env, "stats.total_posts"), incrementTodayPosts(env)]);
}

/**
 * Called when a new user registers.
 * Increments: total_members
 */
export async function incrementStatsOnUserRegister(env: Env): Promise<void> {
	await incrementSettingsCounter(env, "stats.total_members");
}
