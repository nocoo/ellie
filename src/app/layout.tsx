import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Ellie — 同济网论坛",
	description: "同济网社区论坛",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}
