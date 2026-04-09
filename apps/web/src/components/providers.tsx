// components/providers.tsx — Client-side context providers
// Wraps the app tree with SessionProvider for NextAuth v5.
// Also provides AvatarProvider for propagating avatar version updates.

"use client";

import { AvatarProvider } from "@/contexts/avatar-context";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
	return (
		<SessionProvider>
			<AvatarProvider>{children}</AvatarProvider>
		</SessionProvider>
	);
}
