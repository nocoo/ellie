/**
 * Auth.js v5 configuration for Admin Console.
 *
 * Google OAuth authentication for admin panel.
 * Uses default /api/auth routes (no custom basePath).
 */

import NextAuth from "next-auth";
import type { Profile, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getGoogleCredentials() {
	return {
		clientId: process.env.AUTH_GOOGLE_ID ?? "",
		clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
	};
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/** JWT callback — store Google profile info */
function jwtCallback({ token, profile }: { token: JWT; profile?: Profile }): JWT {
	if (profile) {
		token.sub = profile.sub ?? undefined;
		token.email = profile.email ?? undefined;
		token.name = profile.name ?? undefined;
		token.picture = (profile.picture as string) ?? undefined;
	}
	return token;
}

/** Session callback — expose user info to client */
function sessionCallback({ session, token }: { session: Session; token: JWT }): Session {
	if (session.user) {
		session.user.id = token.sub ?? "";
		session.user.email = token.email ?? "";
		session.user.name = token.name ?? "";
		session.user.image = token.picture as string | undefined;
	}
	return session;
}

// ---------------------------------------------------------------------------
// NextAuth configuration
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth({
	trustHost: true,
	providers: [Google(getGoogleCredentials())],
	session: {
		strategy: "jwt",
		maxAge: 24 * 60 * 60, // 24 hours for admin sessions
	},
	callbacks: {
		jwt: jwtCallback,
		session: sessionCallback,
	},
	pages: {
		signIn: "/login",
		error: "/login",
	},
});
