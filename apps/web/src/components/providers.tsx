// components/providers.tsx — Client-side context providers
// Wraps the app tree with SessionProvider for NextAuth v5.
// Phase 2: Add additional providers (e.g., theme, toast) here.

"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
	return <SessionProvider>{children}</SessionProvider>;
}
