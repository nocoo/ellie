// @vitest-environment happy-dom

import { VERSION_DISPLAY } from "@ellie/types";
import { SidebarProvider, TooltipProvider } from "@nocoo/basalt";
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

function renderSidebar() {
	return render(
		<TooltipProvider>
			<SidebarProvider collapsed={false}>
				<Sidebar />
			</SidebarProvider>
		</TooltipProvider>,
	);
}

it("renders the shared version badge beside the Ellie title with the established monospace typography", () => {
	const { container } = renderSidebar();

	const title = screen.getByText("Ellie", { selector: "span" });
	const badge = container.querySelector('[data-slot="sidebar-brand-version"]');

	expect(badge).not.toBeNull();
	expect(badge?.previousElementSibling).toBe(title);
	expect(badge?.textContent).toBe(VERSION_DISPLAY);
	expect(badge?.className).toContain("basalt-inline");
	expect(badge?.className).not.toContain("text-[10px]");
	expect(badge?.firstElementChild?.className).toContain("font-mono");
});
