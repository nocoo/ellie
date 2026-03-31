// Type augmentation for dual-provider NextAuth (Google OAuth + Credentials)
// Ref: docs/04g-user-auth.md §2.4

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
	interface User {
		workerJwt?: string;
		workerRefreshToken?: string;
		role?: number;
		banned?: boolean; // Sentinel for signIn callback (§2.5)
	}
	interface Session {
		user: {
			id: string;
			name: string;
			email?: string;
			image?: string;
			provider: "credentials" | "google";
			role?: number;
		};
		error?: string; // "RefreshTokenExpired"
	}
}

declare module "next-auth/jwt" {
	interface JWT {
		provider?: "credentials" | "google";
		workerJwt?: string;
		workerRefreshToken?: string;
		workerJwtExp?: number;
		role?: number;
		error?: string;
	}
}
