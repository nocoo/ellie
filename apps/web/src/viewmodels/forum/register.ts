// viewmodels/forum/register.ts — Pure registration form logic
// Ref: docs/04g-user-auth.md §4

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Username regex: 2-15 chars, Chinese/English/digits/underscore */
const USERNAME_REGEX = /^[一-龥a-zA-Z0-9_]{2,15}$/;

/** Validate username format. Returns error message or null. */
export function validateUsername(username: string): string | null {
	const trimmed = username.trim();
	if (!trimmed) return "请输入用户名";
	if (trimmed.length < 2) return "用户名至少 2 个字符";
	if (trimmed.length > 15) return "用户名最多 15 个字符";
	if (!USERNAME_REGEX.test(trimmed)) return "用户名只能包含中英文、数字、下划线";
	return null;
}

/** Password strength levels */
export type PasswordStrength = "none" | "weak" | "medium" | "strong";

/** Evaluate password strength. */
export function passwordStrength(password: string): PasswordStrength {
	if (password.length < 6) return "none";

	// Count character types
	let types = 0;
	if (/[a-z]/.test(password)) types++;
	if (/[A-Z]/.test(password)) types++;
	if (/[0-9]/.test(password)) types++;
	if (/[^a-zA-Z0-9]/.test(password)) types++;

	if (password.length >= 12 || (password.length >= 8 && types >= 3)) return "strong";
	if (password.length >= 8) return "medium";
	return "weak";
}

/** Email format regex (loose) */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate email format. Returns error message or null. Email is required. */
export function validateEmail(email: string): string | null {
	const trimmed = email.trim();
	if (!trimmed) return "请输入邮箱";
	if (!EMAIL_REGEX.test(trimmed)) return "邮箱格式不正确";
	return null;
}

/**
 * Validate birthday fields. Returns error message or null.
 * All three fields must be either all empty or all valid.
 */
export function validateBirthday(year: string, month: string, day: string): string | null {
	const y = year.trim();
	const m = month.trim();
	const d = day.trim();

	// All empty — optional, OK
	if (!y && !m && !d) return null;

	// Partial fill — require all three
	if (!y || !m || !d) return "请完整填写出生日期（年、月、日）";

	// Must be numeric
	const yNum = Number.parseInt(y, 10);
	const mNum = Number.parseInt(m, 10);
	const dNum = Number.parseInt(d, 10);

	if (Number.isNaN(yNum) || String(yNum) !== y) return "年份须为数字";
	if (Number.isNaN(mNum) || String(mNum) !== m) return "月份须为数字";
	if (Number.isNaN(dNum) || String(dNum) !== d) return "日期须为数字";

	// Range checks
	const currentYear = new Date().getFullYear();
	if (yNum < 1900 || yNum > currentYear) return `年份须在 1900–${currentYear} 之间`;
	if (mNum < 1 || mNum > 12) return "月份须在 1–12 之间";

	// Days in month (handles leap years via Date constructor)
	const maxDay = new Date(yNum, mNum, 0).getDate();
	if (dNum < 1 || dNum > maxDay) return `${mNum} 月最多 ${maxDay} 天`;

	return null;
}

/** Validate QQ number. Returns error message or null. Empty = optional. */
export function validateQQ(qq: string): string | null {
	const trimmed = qq.trim();
	if (!trimmed) return null;
	if (!/^\d+$/.test(trimmed)) return "QQ 号码只能包含数字";
	if (trimmed.length < 5) return "QQ 号码至少 5 位";
	return null;
}

/** Validate site URL. Returns error message or null. Empty = optional. */
export function validateSite(site: string): string | null {
	const trimmed = site.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return "网站地址须以 http:// 或 https:// 开头";
		}
		return null;
	} catch {
		return "网站地址格式不正确";
	}
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

export interface RegisterFormState {
	username: string;
	password: string;
	confirmPassword: string;
	email: string;
	// Profile fields
	gender: number;
	campus: string;
	birthYear: string;
	birthMonth: string;
	birthDay: string;
	resideProvince: string;
	resideCity: string;
	graduateSchool: string;
	bio: string;
	interest: string;
	qq: string;
	site: string;
	signature: string;
}

/** Default initial state for register form profile fields */
export const REGISTER_PROFILE_DEFAULTS: Omit<
	RegisterFormState,
	"username" | "password" | "confirmPassword" | "email"
> = {
	gender: 0,
	campus: "",
	birthYear: "",
	birthMonth: "",
	birthDay: "",
	resideProvince: "",
	resideCity: "",
	graduateSchool: "",
	bio: "",
	interest: "",
	qq: "",
	site: "",
	signature: "",
};

/** Check if register form can be submitted. */
export function canSubmitRegister(state: RegisterFormState): boolean {
	if (validateUsername(state.username) !== null) return false;
	if (state.password.length < 6) return false;
	if (state.password !== state.confirmPassword) return false;
	if (validateEmail(state.email) !== null) return false;
	// Education fields are required
	if (!state.graduateSchool.trim()) return false;
	if (!state.campus.trim()) return false;
	// Birthday validation (optional but must be valid if partially filled)
	if (validateBirthday(state.birthYear, state.birthMonth, state.birthDay) !== null) return false;
	// QQ and site format validation
	if (validateQQ(state.qq) !== null) return false;
	if (validateSite(state.site) !== null) return false;
	return true;
}

/**
 * Build the profile object for the register API call.
 * Only includes fields that differ from defaults (non-empty / non-zero).
 */
export function buildRegisterProfile(
	state: RegisterFormState,
): Record<string, unknown> | undefined {
	const profile: Record<string, unknown> = {};
	if (state.gender !== 0) profile.gender = state.gender;
	if (state.campus.trim()) profile.campus = state.campus.trim();
	const by = Number.parseInt(state.birthYear, 10);
	if (!Number.isNaN(by) && by > 0) profile.birthYear = by;
	const bm = Number.parseInt(state.birthMonth, 10);
	if (!Number.isNaN(bm) && bm > 0) profile.birthMonth = bm;
	const bd = Number.parseInt(state.birthDay, 10);
	if (!Number.isNaN(bd) && bd > 0) profile.birthDay = bd;
	if (state.resideProvince.trim()) profile.resideProvince = state.resideProvince.trim();
	if (state.resideCity.trim()) profile.resideCity = state.resideCity.trim();
	if (state.graduateSchool.trim()) profile.graduateSchool = state.graduateSchool.trim();
	if (state.bio.trim()) profile.bio = state.bio.trim();
	if (state.interest.trim()) profile.interest = state.interest.trim();
	if (state.qq.trim()) profile.qq = state.qq.trim();
	if (state.site.trim()) profile.site = state.site.trim();
	if (state.signature.trim()) profile.signature = state.signature.trim();
	return Object.keys(profile).length > 0 ? profile : undefined;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/** Map Worker error codes to user-facing Chinese messages. */
export function registerErrorMessage(errorCode: string | null | undefined): string | null {
	if (!errorCode) return null;
	switch (errorCode) {
		case "REGISTRATION_DISABLED":
			return "系统暂不开放注册";
		case "USERNAME_TAKEN":
			return "该用户名已被注册";
		case "USERNAME_BANNED":
			return "用户名包含违禁词";
		case "INVALID_USERNAME":
			return "用户名格式不正确";
		case "INVALID_PASSWORD":
			return "密码至少需要 6 个字符";
		case "INVALID_EMAIL":
			return "邮箱格式不正确";
		case "RATE_LIMITED":
			return "注册太频繁，请稍后再试";
		default:
			return "注册失败，请重试";
	}
}
