// auth.ts — NextAuth configuration with mock credentials provider
// Ref: 04-application §4.3.8, 04a §User
// Mock phase: validates against MOCK_USERS data
// Phase 2: switch to real D1 password_hash verification

import { MOCK_USERS } from "@/data/mock/users";
import { UserStatus } from "@/models/types";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Mock password validation.
 * In the mock phase, any password matching the username is accepted.
 * Phase 2 will use bcrypt against password_hash from D1.
 */
function validateMockCredentials(username: string, password: string) {
	const user = MOCK_USERS.find((u) => u.username === username);
	if (!user) return null;
	if (user.status !== UserStatus.Active) return null;
	// Mock: password must equal username (simplest possible validation)
	if (password !== username) return null;
	return user;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
	providers: [
		Credentials({
			name: "credentials",
			credentials: {
				username: { label: "Username", type: "text" },
				password: { label: "Password", type: "password" },
			},
			async authorize(credentials) {
				const username = credentials?.username;
				const password = credentials?.password;
				if (typeof username !== "string" || typeof password !== "string") return null;

				const user = validateMockCredentials(username, password);
				if (!user) return null;

				return {
					id: String(user.id),
					name: user.username,
					email: user.email,
					image: user.avatar || null,
				};
			},
		}),
	],
	callbacks: {
		async jwt({ token, user }) {
			if (user) {
				token.userId = Number(user.id);
				// Look up role from mock data
				const mockUser = MOCK_USERS.find((u) => u.id === Number(user.id));
				if (mockUser) {
					token.role = mockUser.role;
				}
			}
			return token;
		},
		async session({ session, token }) {
			if (session.user) {
				session.user.id = String(token.userId);
				(session.user as unknown as Record<string, unknown>).role = token.role;
			}
			return session;
		},
	},
	pages: {
		signIn: "/login",
	},
	session: {
		strategy: "jwt",
	},
});

// Export the validate function for testing
export { validateMockCredentials };
