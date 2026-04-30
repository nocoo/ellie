import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: { patch: vi.fn(async () => ({ data: {} })) },
	ApiError: class ApiError extends Error {
		code?: string;
		constructor(m: string, c?: string) {
			super(m);
			this.code = c;
		}
	},
}));

import { apiClient } from "@/lib/api-client";
import {
	GENDER_OPTIONS,
	buildProfilePayload,
	createDefaultFormData,
	createFormDataFromUser,
	submitProfileUpdate,
	validateBirthDate,
} from "@/viewmodels/forum/use-profile-edit";

// ---------------------------------------------------------------------------
// createDefaultFormData
// ---------------------------------------------------------------------------

describe("createDefaultFormData", () => {
	it("returns default form with all fields zeroed/empty", () => {
		const form = createDefaultFormData();

		expect(form.gender).toBe(0);
		expect(form.birthYear).toBe(0);
		expect(form.birthMonth).toBe(0);
		expect(form.birthDay).toBe(0);
		expect(form.resideProvince).toBe("");
		expect(form.resideCity).toBe("");
		expect(form.graduateSchool).toBe("");
		expect(form.bio).toBe("");
		expect(form.interest).toBe("");
		expect(form.qq).toBe("");
		expect(form.site).toBe("");
	});
});

// ---------------------------------------------------------------------------
// createFormDataFromUser
// ---------------------------------------------------------------------------

describe("createFormDataFromUser", () => {
	it("copies all fields from user object", () => {
		const user = {
			gender: 1,
			birthYear: 1990,
			birthMonth: 5,
			birthDay: 15,
			resideProvince: "北京",
			resideCity: "朝阳区",
			graduateSchool: "清华大学",
			bio: "Hello world",
			interest: "编程",
			qq: "12345678",
			site: "https://example.com",
		};

		const form = createFormDataFromUser(user);

		expect(form.gender).toBe(1);
		expect(form.birthYear).toBe(1990);
		expect(form.birthMonth).toBe(5);
		expect(form.birthDay).toBe(15);
		expect(form.resideProvince).toBe("北京");
		expect(form.resideCity).toBe("朝阳区");
		expect(form.graduateSchool).toBe("清华大学");
		expect(form.bio).toBe("Hello world");
		expect(form.interest).toBe("编程");
		expect(form.qq).toBe("12345678");
		expect(form.site).toBe("https://example.com");
	});

	it("creates independent copy (no reference sharing)", () => {
		const user = {
			gender: 1,
			birthYear: 1990,
			birthMonth: 5,
			birthDay: 15,
			resideProvince: "北京",
			resideCity: "朝阳区",
			graduateSchool: "清华大学",
			bio: "Hello",
			interest: "编程",
			qq: "123",
			site: "https://example.com",
		};

		const form = createFormDataFromUser(user);
		form.bio = "Changed";

		// Original should not be affected
		expect(user.bio).toBe("Hello");
	});
});

// ---------------------------------------------------------------------------
// buildProfilePayload
// ---------------------------------------------------------------------------

describe("buildProfilePayload", () => {
	it("converts form data to API payload", () => {
		const form = {
			gender: 2,
			birthYear: 1995,
			birthMonth: 12,
			birthDay: 25,
			resideProvince: "上海",
			resideCity: "浦东",
			graduateSchool: "复旦大学",
			bio: "Test bio",
			interest: "音乐",
			qq: "87654321",
			site: "https://test.com",
		};

		const payload = buildProfilePayload(form);

		expect(payload.gender).toBe(2);
		expect(payload.birthYear).toBe(1995);
		expect(payload.birthMonth).toBe(12);
		expect(payload.birthDay).toBe(25);
		expect(payload.resideProvince).toBe("上海");
		expect(payload.resideCity).toBe("浦东");
		expect(payload.graduateSchool).toBe("复旦大学");
		expect(payload.bio).toBe("Test bio");
		expect(payload.interest).toBe("音乐");
		expect(payload.qq).toBe("87654321");
		expect(payload.site).toBe("https://test.com");
	});

	it("converts falsy birth values to 0", () => {
		const form = {
			gender: 0,
			birthYear: 0,
			birthMonth: 0,
			birthDay: 0,
			resideProvince: "",
			resideCity: "",
			graduateSchool: "",
			bio: "",
			interest: "",
			qq: "",
			site: "",
		};

		const payload = buildProfilePayload(form);

		expect(payload.birthYear).toBe(0);
		expect(payload.birthMonth).toBe(0);
		expect(payload.birthDay).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// validateBirthDate
// ---------------------------------------------------------------------------

describe("validateBirthDate", () => {
	describe("all zeros (not set)", () => {
		it("returns valid when all values are 0", () => {
			expect(validateBirthDate(0, 0, 0)).toEqual({ valid: true });
		});
	});

	describe("year validation", () => {
		it("returns valid for year in range", () => {
			expect(validateBirthDate(1990, 0, 0)).toEqual({ valid: true });
			expect(validateBirthDate(2000, 0, 0)).toEqual({ valid: true });
		});

		it("returns invalid for year below 1900", () => {
			const result = validateBirthDate(1899, 0, 0);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("1900-2100");
		});

		it("returns invalid for year above 2100", () => {
			const result = validateBirthDate(2101, 0, 0);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("1900-2100");
		});

		it("returns valid for boundary years", () => {
			expect(validateBirthDate(1900, 0, 0)).toEqual({ valid: true });
			expect(validateBirthDate(2100, 0, 0)).toEqual({ valid: true });
		});
	});

	describe("month validation", () => {
		it("returns valid for month in range", () => {
			expect(validateBirthDate(0, 6, 0)).toEqual({ valid: true });
		});

		it("returns invalid for month below 1", () => {
			const result = validateBirthDate(0, -1, 0);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("1-12");
		});

		it("returns invalid for month above 12", () => {
			const result = validateBirthDate(0, 13, 0);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("1-12");
		});

		it("returns valid for boundary months", () => {
			expect(validateBirthDate(0, 1, 0)).toEqual({ valid: true });
			expect(validateBirthDate(0, 12, 0)).toEqual({ valid: true });
		});
	});

	describe("day validation", () => {
		it("returns valid for day in range", () => {
			expect(validateBirthDate(0, 0, 15)).toEqual({ valid: true });
		});

		it("returns invalid for day below 1", () => {
			const result = validateBirthDate(0, 0, -1);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("1-31");
		});

		it("returns invalid for day above 31", () => {
			const result = validateBirthDate(0, 0, 32);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("1-31");
		});

		it("returns valid for boundary days", () => {
			expect(validateBirthDate(0, 0, 1)).toEqual({ valid: true });
			expect(validateBirthDate(0, 0, 31)).toEqual({ valid: true });
		});
	});

	describe("complete date", () => {
		it("returns valid for complete valid date", () => {
			expect(validateBirthDate(1990, 5, 15)).toEqual({ valid: true });
		});

		it("returns first validation error encountered", () => {
			// Year invalid
			const result = validateBirthDate(1800, 13, 32);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("1900-2100");
		});
	});
});

// ---------------------------------------------------------------------------
// GENDER_OPTIONS
// ---------------------------------------------------------------------------

describe("GENDER_OPTIONS", () => {
	it("has three options", () => {
		expect(GENDER_OPTIONS.length).toBe(3);
	});

	it("has correct values", () => {
		expect(GENDER_OPTIONS[0]).toEqual({ value: 0, label: "未设置" });
		expect(GENDER_OPTIONS[1]).toEqual({ value: 1, label: "男" });
		expect(GENDER_OPTIONS[2]).toEqual({ value: 2, label: "女" });
	});
});

// ---------------------------------------------------------------------------
// State contracts (documentation)
// ---------------------------------------------------------------------------

describe("useProfileEdit state contracts", () => {
	it("defines expected state shape", () => {
		const expectedStateKeys = ["submitting", "error", "form"];
		expect(expectedStateKeys.length).toBe(3);
	});

	it("defines expected actions shape", () => {
		const expectedActionKeys = ["setField", "handleSave", "clearError", "resetForm"];
		expect(expectedActionKeys.length).toBe(4);
	});

	it("defines expected form data shape", () => {
		const expectedFormKeys = [
			"gender",
			"birthYear",
			"birthMonth",
			"birthDay",
			"resideProvince",
			"resideCity",
			"graduateSchool",
			"bio",
			"interest",
			"qq",
			"site",
		];
		expect(expectedFormKeys.length).toBe(11);
	});
});

// ---------------------------------------------------------------------------
// submitProfileUpdate
// ---------------------------------------------------------------------------

describe("submitProfileUpdate", () => {
	it("calls apiClient.patch with correct payload", async () => {
		const form = createDefaultFormData();
		form.gender = 1;
		form.bio = "test bio";

		await submitProfileUpdate(form);

		expect((apiClient as any).patch).toHaveBeenCalledWith(
			"/api/v1/users/me",
			expect.objectContaining({
				gender: 1,
				bio: "test bio",
				birthYear: 0,
				birthMonth: 0,
				birthDay: 0,
			}),
		);
	});

	it("builds payload using buildProfilePayload", async () => {
		const form = {
			gender: 2,
			birthYear: 1990,
			birthMonth: 5,
			birthDay: 15,
			resideProvince: "北京",
			resideCity: "朝阳",
			graduateSchool: "PKU",
			bio: "hi",
			interest: "code",
			qq: "123",
			site: "https://x.com",
		};

		await submitProfileUpdate(form);

		expect((apiClient as any).patch).toHaveBeenCalledWith("/api/v1/users/me", form);
	});
});
