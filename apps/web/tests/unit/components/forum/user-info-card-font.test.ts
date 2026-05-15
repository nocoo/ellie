// @vitest-environment happy-dom
// UserInfoCard 14/12 font baseline — info values (个人网站/QQ/居住地/...) and
// custom title are content-tier (14px), labels stay at 12px per zheng-li's口径.

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children, className, ...rest }: any) =>
		createElement("span", { className, ...rest }, children),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: any) => createElement("div", null, children),
	CardHeader: ({ children }: any) => createElement("div", null, children),
	CardContent: ({ children }: any) => createElement("div", null, children),
}));

vi.mock("@/viewmodels/forum/user-profile", () => ({
	formatGender: (g: any) => (g ? "男" : null),
	formatBirthday: () => "1990-01-01",
	formatLocation: () => "北京 海淀",
	formatOlTime: () => "100 小时",
	formatLastActivity: () => "2026-05-01",
	formatCheckinLevel: () => "Lv.3 活跃居民",
	formatCheckinDays: () => "累计 30 天",
}));

import { UserInfoCard } from "@/components/forum/user-info-card";

afterEach(() => {
	cleanup();
});

function makeUser(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		username: "alice",
		gender: 1,
		birthYear: 1990,
		birthMonth: 1,
		birthDay: 1,
		resideProvince: "北京",
		resideCity: "海淀",
		olTime: 100,
		lastActivity: 1_700_000_000,
		checkin: { totalDays: 30 },
		campus: "北校区",
		graduateSchool: "",
		qq: "12345",
		site: "example.com",
		bio: "",
		interest: "",
		groupTitle: "",
		customTitle: "活跃用户",
		groupColor: "",
		groupStars: 0,
		...overrides,
	} as any;
}

describe("UserInfoCard — 14/12 baseline", () => {
	it("custom title uses text-sm (was text-xs — italic flavor text is content-tier)", () => {
		render(createElement(UserInfoCard, { user: makeUser() }));
		const el = screen.getByTestId("user-info-custom-title");
		expect(el.className).toContain("text-sm");
		expect(el.className).not.toContain("text-xs");
	});

	it("info row values use text-sm (was text-xs — values are content-tier)", () => {
		render(createElement(UserInfoCard, { user: makeUser() }));
		const values = screen.getAllByTestId("user-info-value");
		expect(values.length).toBeGreaterThan(0);
		for (const v of values) {
			expect(v.className).toContain("text-sm");
			expect(v.className).not.toMatch(/\btext-xs\b/);
		}
	});

	it("info row labels remain text-xs (labels are meta-tier)", () => {
		render(createElement(UserInfoCard, { user: makeUser() }));
		const label = screen.getByText("个人网站");
		expect(label.className).toContain("text-xs");
	});
});
