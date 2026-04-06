// components/providers.tsx — Client-side context providers
// Wraps the app tree with SessionProvider for NextAuth.

"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
	return <SessionProvider>{children}</SessionProvider>;
}
