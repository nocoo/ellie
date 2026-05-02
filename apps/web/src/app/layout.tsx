import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tailwind.css";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import { DM_Sans, Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
	title: "ellie - 论坛归档",
	description: "",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN" className={cn(inter.variable, dmSans.variable)} suppressHydrationWarning>
			<head>
				<script async src="/fouc.js" fetchPriority="high" />
			</head>
			<body>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
