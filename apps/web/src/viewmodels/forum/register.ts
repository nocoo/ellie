// viewmodels/forum/register.ts — Pure registration form logic
// Ref: docs/04g-user-auth.md §4

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Username regex: 2-15 chars, Chinese/English/digits/underscore */
const USERNAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9_]{2,15}$/;

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

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

export interface RegisterFormState {
	username: string;
	password: string;
	confirmPassword: string;
	email: string;
	// Optional profile fields
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
