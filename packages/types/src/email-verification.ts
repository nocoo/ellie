// Email verification — shared payload contract (docs/17 §5.4 — Rev4).
//
// Any write request rejected by `requireVerifiedEmail` / `withVerifiedEmail` /
// the email-aware extension of `moderationMiddleware` MUST return this exact
// JSON body (HTTP 403, Content-Type: application/json).
//
// The same shape is used by:
//   - the Worker (rejection response body),
//   - the web fetch wrapper (403 fallback dialog payload),
//   - the web write-button handler (pre-flight dialog payload from constant).
//
// Because the payload is referenced from three places it lives in this shared
// `@ellie/types` package, and is the single source of truth for the schema +
// the canonical Chinese copy. Any wording change MUST come back to docs §5.4.

/**
 * Variant of the CTA button rendered in the EmailNotVerifiedDialog. Reserved
 * for future expansion; rev4 only ships `"primary"`.
 */
export type EmailNotVerifiedCtaVariant = "primary";

export interface EmailNotVerifiedDialog {
	/** Dialog title (i18n key not used — copy is locked to zh-CN per §5.4). */
	title: string;
	/** Dialog body, single paragraph. */
	body: string;
	/** Label of the single primary CTA. */
	cta_label: string;
	/** Visual variant of the CTA. Reserved; only `"primary"` is shipped. */
	cta_variant: EmailNotVerifiedCtaVariant;
}

/**
 * Flat 403 body emitted by Worker write-route gates (docs/17 §5.4).
 * Note the `error` field is the literal string `"EMAIL_NOT_VERIFIED"`, NOT
 * the wrapped `{ error: { code, message } }` shape used by other Worker
 * errors — frontend dispatches dialogs by string-equal on `error`.
 */
export interface EmailNotVerifiedPayload {
	error: "EMAIL_NOT_VERIFIED";
	message: string;
	dialog: EmailNotVerifiedDialog;
	/** Always a same-site relative path. Rev4 default: `/me#email`. */
	redirect_to: string;
}

/**
 * Canonical EmailNotVerifiedPayload (docs/17 §5.4).
 *
 * IMPORTANT: this object is `as const` and treated as immutable. Callers MUST
 * NOT mutate it. To send it as a JSON body or pass it to dialog components,
 * spread it (`{ ...EMAIL_NOT_VERIFIED_PAYLOAD }`) or otherwise clone — never
 * pass the constant by reference into anything that may mutate.
 */
export const EMAIL_NOT_VERIFIED_PAYLOAD: EmailNotVerifiedPayload = {
	error: "EMAIL_NOT_VERIFIED",
	message: "请先验证邮箱后再发布或回复内容。",
	dialog: {
		title: "需要验证邮箱",
		body: "你的账户还未验证邮箱，目前只能浏览。请前往个人中心绑定并验证邮箱后再继续。",
		cta_label: "去验证邮箱",
		cta_variant: "primary",
	},
	redirect_to: "/me#email",
} as const;

/**
 * Defensive clone of the canonical payload. Use this when about to JSON-stringify
 * for a Response body or when handing the payload to a dialog component, to
 * avoid sharing the constant by reference.
 */
export function cloneEmailNotVerifiedPayload(): EmailNotVerifiedPayload {
	return {
		error: EMAIL_NOT_VERIFIED_PAYLOAD.error,
		message: EMAIL_NOT_VERIFIED_PAYLOAD.message,
		dialog: { ...EMAIL_NOT_VERIFIED_PAYLOAD.dialog },
		redirect_to: EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to,
	};
}

// ─── Request bodies (docs/17 §7.2 / §7.3, §9) ───────────────────────────
//
// Shape contracts shared by the Worker handler, the Next.js proxy route and
// the web `<EmailVerificationCard>`. They describe the *wire shape* — fields
// are typed as the strings they appear as in JSON. The Worker MUST still run
// runtime validation (length, format, normalization, etc.) before trusting
// any field; these types only buy compile-time safety against rename / typo.

/**
 * POST /api/v1/users/me/email/request-code body.
 * Carries the pending email the user wants to verify. Client-side Cap
 * captcha gates the send button; the token is NOT forwarded to the Worker
 * (same model as login/register).
 */
export interface EmailRequestCodeBody {
	email: string;
}

/**
 * POST /api/v1/users/me/email/verify body.
 * The submit step is intentionally captcha-free: a successful captcha was
 * already burned at request-code time, so adding one here would only
 * frustrate the legitimate user. Re-validating `email` matches the KV
 * `pendingEmailNormalized` is the responsibility of the Worker handler.
 */
export interface EmailVerifyCodeBody {
	email: string;
	code: string;
}
