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
export declare const EMAIL_NOT_VERIFIED_PAYLOAD: EmailNotVerifiedPayload;
/**
 * Defensive clone of the canonical payload. Use this when about to JSON-stringify
 * for a Response body or when handing the payload to a dialog component, to
 * avoid sharing the constant by reference.
 */
export declare function cloneEmailNotVerifiedPayload(): EmailNotVerifiedPayload;
/**
 * POST /api/v1/users/me/email/request-code body.
 * Carries the pending email the user wants to verify and the Cloudflare
 * Turnstile token captured by the widget. The token is mandatory in rev4
 * (§7.2.1, fail-closed) — see Worker handler for runtime enforcement.
 */
export interface EmailRequestCodeBody {
    email: string;
    cf_turnstile_token: string;
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
