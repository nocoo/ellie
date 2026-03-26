import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tailwind.css";
import { Providers } from "@/components/providers";
import { themeInitScript } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { Geist } from "next/font/google";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
	title: "Ellie — 同济网论坛",
	description: "同济网社区论坛",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: FOUC prevention must be inline script */}
				<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
			</head>
			<body>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
