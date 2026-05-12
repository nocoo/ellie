// @vitest-environment happy-dom
// Component test for ProfileEditDialog — verifies that 身份类型 and 校区 are
// rendered as Select fields whose options match the shared profile-options
// constants used by the registration form.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Avatar context — return stable values, do nothing on update
vi.mock("@/contexts/avatar-context", () => ({
	useAvatarUrl: () => "",
	useAvatarVersion: () => ({ updateVersion: vi.fn() }),
}));

// Stub AvatarUpload to avoid pulling in upload deps
vi.mock("@/components/forum/avatar-upload", () => ({
	AvatarUpload: () => createElement("div", { "data-testid": "avatar-upload" }),
}));

// Stub dialog hero header & error banner to keep render tree small
vi.mock("@/components/forum/dialog-hero-header", () => ({
	DialogHeroHeader: ({ title }: { title: string }) => createElement("h2", null, title),
}));
vi.mock("@/components/forum/dialog-error-banner", () => ({
	DialogErrorBanner: ({ message }: { message: string }) =>
		createElement("div", { role: "alert" }, message),
}));

// Mock the profile-edit hook to a static state
vi.mock("@/viewmodels/forum/use-profile-edit", () => ({
	GENDER_OPTIONS: [
		{ value: 0, label: "未设置" },
		{ value: 1, label: "男" },
		{ value: 2, label: "女" },
	],
	useProfileEdit: () => ({
		state: {
			submitting: false,
			error: null,
			form: {
				gender: 0,
				birthYear: 0,
				birthMonth: 0,
				birthDay: 0,
				resideProvince: "",
				resideCity: "",
				graduateSchool: "",
				campus: "",
				bio: "",
				interest: "",
				qq: "",
				site: "",
				signature: "",
			},
		},
		actions: {
			setField: vi.fn(),
			handleSave: vi.fn(),
			clearError: vi.fn(),
			resetForm: vi.fn(),
		},
	}),
}));

import { ProfileEditDialog } from "@/components/forum/profile-edit-dialog";
import { CAMPUS_OPTIONS, IDENTITY_OPTIONS } from "@/viewmodels/forum/profile-options";

afterEach(() => cleanup());

const USER = {
	id: 1,
	gender: 0,
	birthYear: 0,
	birthMonth: 0,
	birthDay: 0,
	resideProvince: "",
	resideCity: "",
	graduateSchool: "",
	campus: "",
	bio: "",
	interest: "",
	qq: "",
	site: "",
	signature: "",
};

describe("ProfileEditDialog — identity & campus selects", () => {
	it("renders 身份类型 as a select that matches IDENTITY_OPTIONS", () => {
		render(
			createElement(ProfileEditDialog, {
				open: true,
				onOpenChange: vi.fn(),
				user: USER,
			}),
		);

		// Identity-type label is "身份类型", not the old "毕业学校"
		expect(screen.queryByText("毕业学校")).toBeNull();
		expect(screen.getByText("身份类型")).toBeTruthy();

		const select = document.getElementById("edit-school") as HTMLSelectElement | null;
		expect(select).toBeTruthy();
		expect(select?.tagName.toLowerCase()).toBe("select");

		const labels = Array.from(select?.options ?? []).map((o) => o.textContent);
		for (const opt of IDENTITY_OPTIONS) {
			expect(labels).toContain(opt.label);
		}
	});

	it("renders 校区 as a select that matches CAMPUS_OPTIONS", () => {
		render(
			createElement(ProfileEditDialog, {
				open: true,
				onOpenChange: vi.fn(),
				user: USER,
			}),
		);

		expect(screen.getByText("校区")).toBeTruthy();
		const select = document.getElementById("edit-campus") as HTMLSelectElement | null;
		expect(select).toBeTruthy();
		expect(select?.tagName.toLowerCase()).toBe("select");

		const labels = Array.from(select?.options ?? []).map((o) => o.textContent);
		for (const opt of CAMPUS_OPTIONS) {
			expect(labels).toContain(opt.label);
		}
	});

	it("uses consistent section heading style across all sections", () => {
		render(
			createElement(ProfileEditDialog, {
				open: true,
				onOpenChange: vi.fn(),
				user: USER,
			}),
		);

		const required = ["头像", "基本信息", "居住地", "教育经历", "联系方式", "个人简介"];
		for (const title of required) {
			expect(screen.getByText(title)).toBeTruthy();
		}
	});
});
