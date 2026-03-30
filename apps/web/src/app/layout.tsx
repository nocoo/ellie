import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tailwind.css";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import { DM_Sans, Inter } from "next/font/google";
import Script from "next/script";

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
				{/* FOUC prevention: theme + width-mode applied before first paint */}
				<Script src="/init.js" strategy="beforeInteractive" />
			</head>
			<body>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
