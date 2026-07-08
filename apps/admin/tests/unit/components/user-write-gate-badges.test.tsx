// UserWriteGateBadges — list-page badge summary.
//
// Locks the compact-labels contract (未验证 / 无头像 / 新注册 / 已封禁 …)
// and the "所有通过 → ✓ 可发布" fallback so we don't accidentally leave a
// row visually empty when every gate passes.

// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UserWriteGateBadges } from "@/components/admin/user-write-gate-badges";
import type { User } from "@/viewmodels/admin/users";
import type { WritePermissionSettings } from "@/viewmodels/admin/write-permission";

const NOW = 1_800_000_000;
const DAY = 86_400;

const STRICT: WritePermissionSettings = {
	allowNewThread: true,
	allowReply: true,
	postingRestrictionsEnabled: true,
	minRegistrationDays: 1,
	requireAvatar: true,
};

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 1,
		username: "u",
		email: "u@example.com",
		avatar: "",
		avatarPath: "",
		hasAvatar: false,
		role: 0,
		status: 0,
		threads: 0,
		posts: 0,
		credits: 0,
		coins: 0,
		regDate: NOW - 10 * DAY,
		lastLogin: 0,
		emailVerifiedAt: NOW - 5 * DAY,
		emailNormalized: "u@example.com",
		emailChangedAt: 0,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
});

describe("UserWriteGateBadges", () => {
	it("shows ✓ 可发布 when every gate passes", () => {
		const user = makeUser({ avatarPath: "avatars/x.jpg" });
		render(<UserWriteGateBadges user={user} settings={STRICT} nowSeconds={NOW} />);
		expect(screen.getByTestId("write-gate-pass")).toBeTruthy();
		expect(screen.queryByTestId("write-gate-fail-list")).toBeNull();
		expect(screen.getByText("可发布")).toBeTruthy();
	});

	it("apple58 profile — shows 邮箱未验证 + 无头像 badges", () => {
		const user = makeUser({
			emailVerifiedAt: 0,
			avatarPath: "",
			hasAvatar: false,
			regDate: NOW - 8 * DAY,
		});
		render(<UserWriteGateBadges user={user} settings={STRICT} nowSeconds={NOW} />);
		const list = screen.getByTestId("write-gate-fail-list");
		expect(list.textContent).toContain("邮箱未验证");
		expect(list.textContent).toContain("无头像");
		// Should NOT show a pass badge when any layer fails.
		expect(screen.queryByTestId("write-gate-pass")).toBeNull();
	});

	it("banned user surfaces only 已封禁 (skip items must not render)", () => {
		const user = makeUser({ status: -1 });
		render(<UserWriteGateBadges user={user} settings={STRICT} nowSeconds={NOW} />);
		const list = screen.getByTestId("write-gate-fail-list");
		expect(list.textContent).toContain("已封禁");
		// The four skipped downstream layers must NOT surface as fail badges.
		expect(list.textContent).not.toContain("邮箱未验证");
		expect(list.textContent).not.toContain("无头像");
	});

	it("new registration shows 新注册 badge with numeric title", () => {
		const user = makeUser({ regDate: NOW - 3600, avatarPath: "avatars/x.jpg" });
		render(<UserWriteGateBadges user={user} settings={STRICT} nowSeconds={NOW} />);
		const list = screen.getByTestId("write-gate-fail-list");
		expect(list.textContent).toContain("新注册");
		// Detail (the numeric "0 天 < 1 天") is exposed via the title
		// attribute so it doesn't clutter the row but is still hover-visible.
		const badge = list.querySelector("[title]");
		expect(badge?.getAttribute("title")).toBe("0 天 < 1 天");
	});
});
