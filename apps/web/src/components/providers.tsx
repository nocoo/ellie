// components/providers.tsx — Client-side context providers
// Wraps the app tree with SessionProvider for NextAuth v5.
// Also provides AvatarProvider for propagating avatar version updates,
// and mounts the global EmailVerificationDialog so any client-side fetch
// rejected with the docs/17 §5.4 EMAIL_NOT_VERIFIED payload opens the
// shared dialog without each call site having to wire it.

"use client";

import { EmailVerificationDialogMount } from "@/components/forum/email-verification-dialog";
import { AvatarProvider } from "@/contexts/avatar-context";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
	return (
		<SessionProvider>
			<AvatarProvider>
				{children}
				<EmailVerificationDialogMount />
			</AvatarProvider>
		</SessionProvider>
	);
}
