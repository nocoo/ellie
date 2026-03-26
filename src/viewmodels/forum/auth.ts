// viewmodels/forum/auth.ts — Auth ViewModel
// Ref: 04d §登录页 — login/logout/error states

/**
 * Validate login form fields.
 * Pure function, exported for testing.
 */
export function canLogin(username: string, password: string): boolean {
	return username.trim().length > 0 && password.length > 0;
}

/**
 * Map auth error codes to user-friendly messages.
 * Pure function, exported for testing.
 */
export function getAuthErrorMessage(error: string | null): string | null {
	if (!error) return null;
	switch (error) {
		case "CredentialsSignin":
			return "Invalid username or password";
		case "AccessDenied":
			return "Your account has been banned";
		default:
			return "An error occurred during login";
	}
}

/**
 * Build the redirect URL after login.
 * Pure function, exported for testing.
 */
export function getRedirectUrl(callbackUrl: string | null): string {
	if (!callbackUrl) return "/";
	// Prevent open redirect — only allow relative URLs starting with single /
	if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) return callbackUrl;
	return "/";
}
