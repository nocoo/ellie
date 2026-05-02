/**
 * Server-side "current user" loader for the /me page (and /verify-email
 * deep link in 6D).
 *
 * Why this lives in its own module
 * --------------------------------
 * The /me page renders the EmailVerificationCard, which only needs
 * `{ email, emailVerifiedAt }`. We deliberately project from the Worker's
 * full SelfUser to that narrow view in one place so the page component
 * stays a thin shell and we don't leak unrelated User fields into the
 * client bundle through a wider prop.
 *
 * Auth model (per reviewer guidance, msg 0bb2fc12)
 * -----------------------------------------------
 * - Server-side only. Decrypts the NextAuth cookie via `getWorkerJwt()`
 *   and calls `forumApi.getAuth("/api/v1/auth/me", jwt)` directly.
 * - We do NOT add a new GET proxy route for `/api/v1/auth/me` — the
 *   page is a server component, the call is server-to-Worker.
 * - Returns `null` for any auth failure (no JWT, expired refresh,
 *   Worker rejected). The page component uses `null` as the signal
 *   to redirect to `/login?redirect=/me`.
 *
 * Failure semantics
 * -----------------
 * Worker errors (network, 5xx, USER_NOT_FOUND) propagate as null too.
 * The /me page is a "soft" landing — if auth is fine but the Worker
 * blew up, the user should be sent to login rather than see a stack
 * trace. The page may layer a retry affordance later; for now we keep
 * the loader's contract simple.
 */

import "server-only";

import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import type { EmailVerificationUserView } from "@/viewmodels/forum/email-verification";
import type { User } from "@ellie/types";

/**
 * The shape consumed by the /me page. Currently the same as
 * `EmailVerificationUserView` plus the user's id / username so the
 * surrounding page can render breadcrumbs / titles. Extend as more /me
 * sections come online.
 */
export interface SelfForumUser {
	id: number;
	username: string;
	email: string;
	emailVerifiedAt: number;
}

/**
 * Project a Worker `User` (the SelfUser shape returned by /api/v1/auth/me)
 * down to the narrow `SelfForumUser` view. Pure function so it can be
 * unit-tested without mocks.
 */
export function projectSelfForumUser(user: User): SelfForumUser {
	return {
		id: user.id,
		username: user.username,
		email: user.email,
		emailVerifiedAt: user.emailVerifiedAt,
	};
}

/**
 * Project a `SelfForumUser` further down to what the EmailVerificationCard
 * needs. Kept here (not in the viewmodel) because the viewmodel is
 * client-bundle-safe and shouldn't import server-only types.
 */
export function toEmailVerificationUserView(self: SelfForumUser): EmailVerificationUserView {
	return {
		email: self.email,
		emailVerifiedAt: self.emailVerifiedAt,
	};
}

/**
 * Load the current user from the Worker via `/api/v1/auth/me`. Returns
 * `null` for any failure (no JWT, expired refresh, Worker error). The
 * caller is expected to redirect to /login when this returns null.
 */
export async function getSelfForumUser(): Promise<SelfForumUser | null> {
	const jwt = await getWorkerJwt();
	if (!jwt) return null;

	try {
		const { data } = await forumApi.getAuth<User>("/api/v1/auth/me", jwt);
		return projectSelfForumUser(data);
	} catch (err) {
		// Treat all Worker failures as "not logged in" from the page's POV —
		// a stale JWT, a missing user row, or a transient Worker outage all
		// mean the page can't render its self-view, and the safest UX is to
		// bounce to login. The dialog/banner in Phase 7 has its own §5.4
		// dispatch path; this loader is for the resting page render.
		if (err instanceof ForumApiError) return null;
		return null;
	}
}
