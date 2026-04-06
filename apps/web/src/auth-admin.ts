/**
 * Auth.js v5 configuration for Admin Console.
 *
 * Separate auth instance for admin panel using Google OAuth.
 * Uses distinct cookie name to prevent session conflicts with forum auth.
 *
 * Ref: docs/04g-user-auth.md
 */

import NextAuth from "next-auth";
import type { Profile, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";

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

export const {
	handlers: adminHandlers,
	auth: adminAuth,
	signIn: adminSignIn,
	signOut: adminSignOut,
} = NextAuth({
	trustHost: true,
	providers: [Google],
	session: {
		strategy: "jwt",
		maxAge: 24 * 60 * 60, // 24 hours for admin sessions (reduced from 7 days for security)
	},
	callbacks: {
		jwt: jwtCallback,
		session: sessionCallback,
	},
	cookies: {
		sessionToken: {
			name: "authjs.admin-session-token",
			options: {
				httpOnly: true,
				sameSite: "lax",
				path: "/",
				secure: process.env.NODE_ENV === "production",
			},
		},
		callbackUrl: {
			name: "authjs.admin-callback-url",
			options: {
				sameSite: "lax",
				path: "/",
				secure: process.env.NODE_ENV === "production",
			},
		},
		csrfToken: {
			name: "authjs.admin-csrf-token",
			options: {
				httpOnly: true,
				sameSite: "lax",
				path: "/",
				secure: process.env.NODE_ENV === "production",
			},
		},
	},
	pages: {
		signIn: "/admin/login",
		error: "/admin/login",
	},
	basePath: "/api/admin-auth",
});
