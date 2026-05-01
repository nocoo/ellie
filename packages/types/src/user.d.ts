/**
 * Check if a user is muted (status === Archived / -2).
 *
 * In the Discuz migration context, status -2 maps to "禁言" (muted):
 * the user can still browse but cannot post or reply.
 */
export declare function isUserMuted(status: number | null): boolean;
/**
 * Check if a user is banned (status === Banned / -1).
 *
 * Banned users cannot access the forum at all.
 */
export declare function isUserBanned(status: number | null): boolean;
