// @vitest-environment happy-dom

import { VERSION_DISPLAY } from "@ellie/types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";

vi.mock("next/navigation", () => ({
	usePathname: () => "/admin",
}));

vi.mock("next-auth/react", () => ({
	useSession: () => ({
		data: {
			user: {
				name: "管理员",
				email: "admin@example.com",
				image: null,
			},
		},
	}),
	signOut: vi.fn(),
}));

afterEach(cleanup);

it("renders the shared version badge beside the Ellie title with the established monospace typography", () => {
	render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

	const title = screen.getByText("Ellie", { selector: "span" });
	const badge = screen.getByText(VERSION_DISPLAY);

	expect(badge.previousElementSibling).toBe(title);
	expect(badge.className).toContain("font-mono");
	expect(badge.className).toContain("text-xs");
	expect(badge.className).not.toContain("text-[10px]");
});
