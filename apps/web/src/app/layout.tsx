import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./tailwind.css";
import { DM_Sans, Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { LEGACY_DISCUZ_STUBS_SCRIPT } from "@/lib/legacy-discuz-stubs";
import { themeInitScript } from "@/lib/theme-init";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
	title: "ellie - 论坛归档",
	description: "",
	appleWebApp: { capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "hsl(0 0% 100%)" },
		{ media: "(prefers-color-scheme: dark)", color: "hsl(218 21% 12%)" },
	],
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN" className={cn(inter.variable, dmSans.variable)} suppressHydrationWarning>
			<head>
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
					dangerouslySetInnerHTML={{ __html: `${themeInitScript}\n${LEGACY_DISCUZ_STUBS_SCRIPT}` }}
				/>
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: Traks analytics queue stub, no user input
					dangerouslySetInnerHTML={{
						__html: `window.traks=window.traks||function(){(window.traks.q=window.traks.q||[]).push(arguments)}`,
					}}
				/>
				<script
					defer
					data-site="pb_live_tn8ddj6al5j2m6xhgg2c5vkc"
					src="https://track-collect.nocoo.cloud/t.js"
				/>
			</head>
			<body>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
