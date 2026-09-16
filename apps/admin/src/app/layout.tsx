import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tailwind.css";
import { DM_Sans, Inter } from "next/font/google";
import { Providers } from "@/components/providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "ellie - 管理后台",
	description: "Ellie Admin Console",
};

/**
 * Inline FOUC-prevention script — must run synchronously before first paint.
 * Using dangerouslySetInnerHTML in <head> ensures it runs before body renders.
 */
const foucPreventionScript = `(function(){var t;try{t=localStorage.getItem("theme")}catch(e){}var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d);r.dataset.mode=d?"dark":"light";})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN" className={`${inter.variable} ${dmSans.variable}`} suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: foucPreventionScript }} />
			</head>
			<body className="bg-basalt-background text-basalt-foreground antialiased">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
