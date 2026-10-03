// @vitest-environment happy-dom
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserAvatar } from "@/components/admin/user-avatar";

vi.mock("@nocoo/basalt", () => ({
	Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AvatarImage: ({
		src,
		onLoadingStatusChange,
	}: {
		src: string;
		onLoadingStatusChange: (status: string) => void;
	}) => <img src={src} alt="avatar" onError={() => onLoadingStatusChange("error")} />,
	AvatarFallback: () => null,
}));

afterEach(cleanup);

describe("UserAvatar", () => {
	it("renders the bundled default immediately for no avatar", () => {
		render(<UserAvatar username="Alice" avatarPath="" />);
		expect(screen.getByAltText("avatar").getAttribute("src")).toBe("/default-avatar.gif");
		expect(existsSync(resolve(import.meta.dirname, "../../../public/default-avatar.gif"))).toBe(
			true,
		);
	});

	it.each(["avatars/saved.jpg", "avatar/000/00/00/42_avatar_big.jpg"])(
		"uses only the explicit path, with local failure recovery: %s",
		(avatarPath) => {
			const { rerender } = render(<UserAvatar username="Alice" avatarPath={avatarPath} />);
			const image = screen.getByAltText("avatar");
			expect(image.getAttribute("src")).toBe(`https://t.no.mt/${avatarPath}`);
			fireEvent.error(image);
			expect(image.getAttribute("src")).toBe("/default-avatar.gif");
			fireEvent.error(image);
			expect(image.getAttribute("src")).toBe("/default-avatar.gif");
			rerender(<UserAvatar username="Alice" avatarPath="avatars/new.jpg" size={32} />);
			expect(image.getAttribute("src")).toBe("https://t.no.mt/avatars/new.jpg");
		},
	);
});
