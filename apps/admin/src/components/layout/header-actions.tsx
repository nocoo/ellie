"use client";

import { ThemeToggle } from "@nocoo/basalt";
import { HexlyLink } from "@nocoo/basalt/components/app-header";

export function HeaderActions() {
	return (
		<>
			<HexlyLink
				project="ellie"
				name="Ellie"
				label="在 hexly.ai 查看 Ellie"
				newTabLabel="（新标签页）"
			/>
			<ThemeToggle
				labels={{
					light: "切换浅色主题",
					dark: "切换深色主题",
					system: "跟随系统主题",
				}}
			/>
		</>
	);
}
