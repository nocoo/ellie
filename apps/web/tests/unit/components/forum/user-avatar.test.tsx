// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForumAvatar, TrackedUserAvatar, UserAvatar } from "@/components/forum/user-avatar";
import { FALLBACK_URL } from "@/lib/avatar-proxy";

vi.mock("@/components/ui/avatar", () => ({
	Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AvatarImage: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt} />,
	AvatarFallback: () => null,
}));

afterEach(cleanup);

describe("UserAvatar", () => {
	it.each(["", null])("keeps known legacy paths direct in composed avatars (%s)", (avatarPath) => {
		const { container } = render(
			<>
				<ForumAvatar userId={42} userName="forum" avatarPath={avatarPath} />
				<TrackedUserAvatar uid={42} username="profile" avatarPath={avatarPath} />
			</>,
		);
		const images = container.querySelectorAll("img");
		expect(images).toHaveLength(2);
		for (const image of images) {
			expect(image.getAttribute("src")).toBe("https://t.no.mt/avatar/000/00/00/42_avatar_big.jpg");
		}
	});

	it("uses the static fallback after a missing image and accepts a later uploaded URL", () => {
		const { rerender } = render(
			<UserAvatar src="https://t.no.mt/avatar/000/00/00/42_avatar_big.jpg" alt="avatar" />,
		);
		const image = screen.getByAltText("avatar");
		fireEvent.error(image);
		expect(image.getAttribute("src")).toBe(FALLBACK_URL);
		fireEvent.error(image);
		expect(image.getAttribute("src")).toBe(FALLBACK_URL);

		rerender(<UserAvatar src="https://t.no.mt/avatars/saved.jpg" alt="avatar" />);
		expect(image.getAttribute("src")).toBe("https://t.no.mt/avatars/saved.jpg");
	});
});
