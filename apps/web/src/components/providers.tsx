// components/providers.tsx — Client-side context providers
// Wraps the app tree with SessionProvider for NextAuth v5.
// Also provides AvatarProvider for propagating avatar version updates,
// ForumToastProvider for global toast notifications,
// and mounts the global EmailVerificationDialog so any client-side fetch
// rejected with the docs/17 §5.4 EMAIL_NOT_VERIFIED payload opens the
// shared dialog without each call site having to wire it.

"use client";

import { LinkProvider, ThemeProvider, TooltipProvider } from "@nocoo/basalt";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import Link from "next/link";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { EmailVerificationDialogMount } from "@/components/forum/email-verification-dialog";
import { ForumToastProvider } from "@/components/forum/forum-toast";
import { WriteGateDialogMount } from "@/components/forum/write-gate-dialog";
import { AvatarProvider } from "@/contexts/avatar-context";

const ELLIE_PALETTE = { primary: { light: "204 86% 36%", dark: "204 93% 67%" } };

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider applyToDocument={false}>
			<AccentProvider defaultAccent="primary" persist={false} paletteOverrides={ELLIE_PALETTE}>
				<LinkProvider render={Link}>
					<TooltipProvider>
						<SessionProvider>
							<AvatarProvider>
								<ForumToastProvider>
									{children}
									<EmailVerificationDialogMount />
									<WriteGateDialogMount />
								</ForumToastProvider>
							</AvatarProvider>
						</SessionProvider>
					</TooltipProvider>
				</LinkProvider>
			</AccentProvider>
		</ThemeProvider>
	);
}
