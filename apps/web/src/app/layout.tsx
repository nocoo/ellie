import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tailwind.css";
import { Providers } from "@/components/providers";
import { themeInitScript } from "@/hooks/use-theme";
import { widthModeInitScript } from "@/hooks/use-width-mode";
import { cn } from "@/lib/utils";
import { DM_Sans, Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
	title: "Ellie Admin",
	description: "Ellie admin console",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN" className={cn(inter.variable, dmSans.variable)} suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: FOUC prevention must be inline script */}
				<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: width mode must be set before first paint */}
				<script dangerouslySetInnerHTML={{ __html: widthModeInitScript }} />
			</head>
			<body>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
