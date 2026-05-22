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
	/**
	 * Unix seconds of the most recent pre-verification email correction.
	 * Drives the "纠错一次" affordance in `EmailVerificationCard` — non-zero
	 * means the one-shot correction has already been used.
	 */
	emailChangedAt: number;
	/**
	 * Role and status fields are needed for forum-scope permission
	 * decisions (e.g. `canModerate(user, forum)` for the announcement
	 * edit affordance). Anonymous viewers never reach this shape — see
	 * `getSelfForumUser` which returns `null` on any auth failure — so
	 * UI consumers can treat any non-null `SelfForumUser` as a logged-in
	 * forum identity. The numeric values match the `UserRole` /
	 * `UserStatus` enums in `@ellie/types`.
	 */
	role: number;
	status: number;
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
		emailChangedAt: user.emailChangedAt,
		role: user.role,
		status: user.status,
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
		emailChangedAt: self.emailChangedAt,
	};
}

/**
 * Load the current user from the Worker via `/api/v1/auth/me`. Returns
 * `null` for any failure (no JWT, expired refresh, Worker error,
 * cookie-decrypt throw, missing AUTH_SECRET). The caller is expected
 * to redirect to /login when this returns null.
 *
 * Why the whole body is inside one try/catch
 * ------------------------------------------
 * `getWorkerJwt()` is not infallible: it goes through `headers()`,
 * reads `AUTH_SECRET` (throws when unset), and runs `getToken()`
 * (which can throw on a malformed / corrupted JWE cookie). Reviewer
 * requirement (msg dd5aee78): a thrown loader must NOT 500 the /me
 * page; it must surface as `null` so the page falls through to the
 * login-redirect fence. So the cookie-decrypt path lives inside the
 * same catch as the Worker call.
 */
export async function getSelfForumUser(): Promise<SelfForumUser | null> {
	try {
		const jwt = await getWorkerJwt();
		if (!jwt) return null;
		const { data } = await forumApi.getAuth<User>("/api/v1/auth/me", jwt);
		return projectSelfForumUser(data);
	} catch (err) {
		// Treat every failure path identically — stale JWT, missing user row,
		// transient Worker outage, missing AUTH_SECRET, malformed cookie —
		// they all mean the page can't render its self-view, and the safest
		// UX is to bounce to login. The dialog/banner in Phase 7 has its own
		// §5.4 dispatch path; this loader is for the resting page render.
		if (err instanceof ForumApiError) return null;
		return null;
	}
}
