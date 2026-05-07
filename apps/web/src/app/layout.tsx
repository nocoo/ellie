import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tailwind.css";
import { Providers } from "@/components/providers";
import { LEGACY_DISCUZ_STUBS_SCRIPT } from "@/lib/legacy-discuz-stubs";
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
				{/*
				 * Legacy Discuz inline-handler compatibility shim.
				 * Historical post HTML embeds `<img onload="thumbImg(this)">` /
				 * `attachimg(this, ...)` / `<img onmouseover="img_onmouseoverfunc(...)">`.
				 * The functions only existed in the old Discuz frontend bundle, so
				 * without these no-op stubs every cached image fires
				 * `Uncaught ReferenceError`. Must run before any post HTML hydrates,
				 * hence inline in <head>. Source: lib/legacy-discuz-stubs.ts.
				 */}
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: hard-coded IIFE constant, no user input
					dangerouslySetInnerHTML={{ __html: LEGACY_DISCUZ_STUBS_SCRIPT }}
				/>
			</head>
			<body>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
