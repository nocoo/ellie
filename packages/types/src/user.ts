// user.ts — User status helper functions
//
// Pure domain checks based on UserStatus enum values.
// These are used by both server (worker) and client (web) code.

import { UserStatus } from "./types";

/**
 * Check if a user is muted (status === Archived / -2).
 *
 * In the Discuz migration context, status -2 maps to "禁言" (muted):
 * the user can still browse but cannot post or reply.
 */
export function isUserMuted(status: number | null): boolean {
	return status === UserStatus.Archived;
}

/**
 * Check if a user is banned (status === Banned / -1).
 *
 * Banned users cannot access the forum at all.
 */
export function isUserBanned(status: number | null): boolean {
	return status === UserStatus.Banned;
}
