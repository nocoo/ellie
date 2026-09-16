"use client";

import { LinkProvider, ThemeProvider, Toaster, TooltipProvider } from "@nocoo/basalt";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import Link from "next/link";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

const ELLIE_PALETTE = { primary: { light: "186 72% 38%", dark: "186 70% 55%" } };

export function Providers({ children }: { children: ReactNode }) {
	return (
		<SessionProvider>
			<ThemeProvider>
				<AccentProvider defaultAccent="primary" persist={false} paletteOverrides={ELLIE_PALETTE}>
					<LinkProvider render={Link}>
						<TooltipProvider delayDuration={0}>
							{children}
							<Toaster />
						</TooltipProvider>
					</LinkProvider>
				</AccentProvider>
			</ThemeProvider>
		</SessionProvider>
	);
}
