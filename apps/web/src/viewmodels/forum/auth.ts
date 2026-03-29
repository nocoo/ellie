// viewmodels/forum/auth.ts — Auth ViewModel pure logic
// Ref: 04d §Login — login/logout/canSubmit validation

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Check if login form can be submitted. */
export function canSubmitLogin(username: string, password: string): boolean {
	return username.trim().length > 0 && password.trim().length > 0;
}

/** Map signIn error to user-facing message. */
export function loginErrorMessage(errorCode: string | null | undefined): string | null {
	if (!errorCode) return null;
	switch (errorCode) {
		case "CredentialsSignin":
			return "用户名或密码错误";
		case "AccessDenied":
			return "账号已被禁用";
		default:
			return "登录失败，请重试";
	}
}
