/**
 * Auth.js v5 configuration for Ellie admin console.
 *
 * Uses JWT strategy (no DB adapter needed — admin-only, no user table).
 * Google OAuth with admin check via ADMIN_GOOGLE_IDS env var.
 */

import NextAuth from "next-auth";
import type { Account, Profile, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";

// ---------------------------------------------------------------------------
// Exported helpers (testable without next-auth runtime)
// ---------------------------------------------------------------------------

/** Persist Google profile data into the JWT token. */
export function jwtCallback({
	token,
	account,
	profile,
}: {
	token: JWT;
	user?: User;
	account?: Account | null;
	profile?: Profile;
}): JWT {
	if (account && profile) {
		token.sub = profile.sub ?? undefined;
		token.email = profile.email ?? undefined;
		token.name = profile.name ?? undefined;
		token.picture = (profile.picture as string) ?? undefined;
	}
	return token;
}

/** Expose Google profile data in the session object. */
export function sessionCallback({
	session,
	token,
}: {
	session: Session;
	token: JWT;
}): Session {
	if (session.user) {
		session.user.id = token.sub ?? "";
		session.user.email = token.email ?? "";
		session.user.name = token.name ?? "";
		session.user.image = token.picture as string | undefined;
	}
	return session;
}

// ---------------------------------------------------------------------------
// NextAuth configuration — lazy init pattern
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth(async () => ({
	trustHost: true,
	providers: [Google],
	session: {
		strategy: "jwt" as const,
	},
	callbacks: {
		jwt: jwtCallback,
		session: sessionCallback,
	},
	pages: {
		signIn: "/login",
		error: "/login",
	},
}));
