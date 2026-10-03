// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AvatarProvider, useAvatarContext, useAvatarUrl } from "@/contexts/avatar-context";

afterEach(cleanup);

function AvatarReader({ uid, path }: { uid: number; path: string }) {
	return <img src={useAvatarUrl(uid, path)} alt={`avatar-${uid}`} />;
}

function UploadResult() {
	const { updateAvatar } = useAvatarContext();
	return (
		<button type="button" onClick={() => updateAvatar(42, "https://t.no.mt/avatars/saved.jpg")}>
			Save
		</button>
	);
}

describe("saved avatar propagation", () => {
	it("updates empty and stale-path readers immediately without changing other users", () => {
		render(
			<AvatarProvider>
				<UploadResult />
				<AvatarReader uid={42} path="" />
				<AvatarReader uid={42} path="avatars/old.jpg" />
				<AvatarReader uid={7} path="" />
			</AvatarProvider>,
		);
		fireEvent.click(screen.getByText("Save"));
		for (const image of screen.getAllByAltText("avatar-42")) {
			expect(image.getAttribute("src")).toBe("https://t.no.mt/avatars/saved.jpg");
		}
		expect(screen.getByAltText("avatar-7").getAttribute("src")).toBe("/default-avatar.gif");
	});

	it("uses an existing GUID path without a provider", () => {
		render(<AvatarReader uid={42} path="avatars/existing.jpg" />);
		expect(screen.getByAltText("avatar-42").getAttribute("src")).toBe(
			"https://t.no.mt/avatars/existing.jpg",
		);
	});

	it("renders the local default for an empty path without a provider", () => {
		render(<AvatarReader uid={42} path="" />);
		expect(screen.getByAltText("avatar-42").getAttribute("src")).toBe("/default-avatar.gif");
	});
});
