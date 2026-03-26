// auth.ts — NextAuth configuration with mock credentials provider
// Ref: 04-application §4.3.8, 04a §User
// Mock phase: validates against the shared MockDataStore user list
// Phase 2: switch to real D1 password_hash verification

import type { User } from "@ellie/types";
import { UserStatus } from "@ellie/types";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Mock password validation against a live user list.
 * - Validates against the provided users array (should be store.users)
 * - Banned/archived users are rejected
 * - Mock rule: password must equal username
 * Phase 2 will use bcrypt against password_hash from D1.
 */
export function validateMockCredentials(
	users: User[],
	username: string,
	password: string,
): User | null {
	const user = users.find((u) => u.username === username);
	if (!user) return null;
	if (user.status !== UserStatus.Active) return null;
	if (password !== username) return null;
	return user;
}

/**
 * Create NextAuth config bound to a specific user data source.
 * This ensures auth checks see the same data as user repository mutations.
 */
export function createAuth(users: User[]) {
	return NextAuth({
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

					const user = validateMockCredentials(users, username, password);
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
					const mockUser = users.find((u) => u.id === Number(user.id));
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
}
