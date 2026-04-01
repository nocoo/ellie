import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tailwind.css";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import { DM_Sans, Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
	title: "Ellie",
	description: "",
};

/**
 * Inline FOUC-prevention script — runs in <head> before any paint.
 *
 * Why inline instead of <Script strategy="beforeInteractive">?
 * - beforeInteractive injects into <body>, so CSS variables resolve to
 *   light-mode defaults before the script can add .dark → white flash.
 * - An inline <script> inside <head> executes synchronously during HTML
 *   parsing, BEFORE the browser performs the first paint.
 *
 * Sets: .dark class, color-scheme property, data-width-mode attribute.
 */
const fouc_prevention_script = `
(function(){
  try{
    var t=localStorage.getItem("theme");
    var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);
    if(d){
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme="dark";
    }else{
      document.documentElement.style.colorScheme="light";
    }
  }catch(e){}
  try{
    var m=localStorage.getItem("width-mode");
    if(m==="full")document.documentElement.dataset.widthMode="full";
  }catch(e){}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN" className={cn(inter.variable, dmSans.variable)} suppressHydrationWarning>
			<head>
				{/* Inline script in <head> prevents FOUC by setting .dark + color-scheme
				    before the browser's first paint. Must NOT be an external script. */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: inline script must run in <head> before first paint to prevent FOUC */}
				<script dangerouslySetInnerHTML={{ __html: fouc_prevention_script }} />
			</head>
			<body>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
