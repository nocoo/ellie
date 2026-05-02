/**
 * Email-not-verified dispatch — pure helpers shared by client fetch wrappers
 * and the global dialog mount.
 *
 * Wire shape
 * ----------
 * The Worker emits the docs/17 §5.4 flat payload on every write rejected by
 * `requireVerifiedEmail`:
 *
 *   { error: "EMAIL_NOT_VERIFIED", message, dialog, redirect_to }
 *
 * The proxy preserves it verbatim (apps/web/src/lib/proxy-error.ts), so by
 * the time the body lands in the browser it still looks like the constant
 * `EMAIL_NOT_VERIFIED_PAYLOAD`. Client fetch wrappers MUST detect this shape
 * and dispatch the global dialog event — falling back to a generic 403 toast
 * would silently break the verification handoff.
 *
 * Why this is its own viewmodel
 * -----------------------------
 * - The discriminator is non-trivial (top-level `error` is a literal string,
 *   not a wrapped object) and has reviewer-mandated fingerprint requirements
 *   (msg b6e62747). Keeping it in one tested module prevents copy/paste drift
 *   when more fetch wrappers add the dispatch.
 * - The dialog mount needs to listen for the event without importing the
 *   detector, so we expose the event name + a typed dispatch helper here.
 *
 * Test surface
 * ------------
 * Pure functions only — `isEmailNotVerifiedPayloadClient`, `pickDialogPayload`,
 * `EMAIL_NOT_VERIFIED_EVENT`, `dispatchEmailNotVerified`. The browser-side
 * `window.dispatchEvent` call is guarded so this module is safe to import
 * from server components too.
 */

import {
	EMAIL_NOT_VERIFIED_PAYLOAD,
	type EmailNotVerifiedCtaVariant,
	type EmailNotVerifiedDialog,
	type EmailNotVerifiedPayload,
} from "@ellie/types";

/**
 * Custom event name for "the global dialog should open with this payload".
 * Listeners (the dialog mount) attach via
 * `window.addEventListener(EMAIL_NOT_VERIFIED_EVENT, ...)`.
 */
export const EMAIL_NOT_VERIFIED_EVENT = "ellie:email-not-verified" as const;

/**
 * Detail shape of the dispatched event. The dialog mount reads it to render
 * the payload's `dialog` body and the `redirect_to` CTA target.
 */
export interface EmailNotVerifiedEventDetail {
	dialog: EmailNotVerifiedDialog;
	redirect_to: string;
}

/**
 * Client-side type guard for the §5.4 flat payload, mirroring the proxy's
 * server-side `isEmailNotVerifiedPayload` (apps/web/src/lib/proxy-error.ts).
 *
 * The reviewer fingerprint (msg b6e62747) requires that we DON'T accept a
 * top-level `error: "EMAIL_NOT_VERIFIED"` alone — the dialog/redirect_to
 * must also be present. Otherwise a malformed body could trigger a dialog
 * with no copy / no CTA.
 */
export function isEmailNotVerifiedPayloadClient(body: unknown): body is EmailNotVerifiedPayload {
	if (body == null || typeof body !== "object") return false;
	const obj = body as Record<string, unknown>;
	if (obj.error !== EMAIL_NOT_VERIFIED_PAYLOAD.error) return false;
	if (typeof obj.message !== "string") return false;
	if (typeof obj.redirect_to !== "string") return false;
	if (obj.dialog == null || typeof obj.dialog !== "object") return false;
	const dlg = obj.dialog as Record<string, unknown>;
	if (typeof dlg.title !== "string") return false;
	if (typeof dlg.body !== "string") return false;
	if (typeof dlg.cta_label !== "string") return false;
	// `cta_variant` is enum-like; if absent the dialog renders the default.
	// Don't require it here — the constant ships it, but we want to forgive
	// minor wire variations rather than swallow the whole dispatch.
	return true;
}

/**
 * Pick the dialog payload to render. Used both by the fetch wrapper (which
 * has the live wire body) and by the write-button preflight (which uses the
 * constant when no Worker call has been made yet).
 *
 * If `body` is the §5.4 shape we trust the wire — the Worker is the source
 * of truth for copy and `redirect_to`. Otherwise we fall back to the
 * canonical constant so the preflight path always has something to render.
 */
export function pickDialogPayload(body: unknown): EmailNotVerifiedEventDetail {
	if (isEmailNotVerifiedPayloadClient(body)) {
		return {
			dialog: { ...body.dialog },
			redirect_to: body.redirect_to,
		};
	}
	return {
		dialog: { ...EMAIL_NOT_VERIFIED_PAYLOAD.dialog },
		redirect_to: EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to,
	};
}

/**
 * Browser-only: dispatch the email-not-verified event. No-op on the server
 * so the helper can be imported from isomorphic code without guards at
 * every call site. Returns `true` if the event was dispatched (browser),
 * `false` otherwise (server) — useful for tests.
 */
export function dispatchEmailNotVerified(detail: EmailNotVerifiedEventDetail): boolean {
	if (typeof window === "undefined") return false;
	window.dispatchEvent(
		new CustomEvent<EmailNotVerifiedEventDetail>(EMAIL_NOT_VERIFIED_EVENT, { detail }),
	);
	return true;
}

/**
 * The set of `cta_variant` values the dialog renderer is willing to
 * pass through to the Button. Anything else (including `undefined` from a
 * forgiving wire body) falls back to the canonical `"primary"` so the
 * Button never receives `undefined` and silently renders the wrong style.
 *
 * Reviewer mandate (msg 5b4f107f): "cta_variant 如果缺失要 fallback 到
 * primary，不要让可选 wire 变体把 Button variant 传成 undefined。"
 */
const ALLOWED_CTA_VARIANTS: ReadonlySet<EmailNotVerifiedCtaVariant> = new Set(["primary"]);

/**
 * Normalize the wire dialog's `cta_variant` to a value the renderer can
 * trust. Pure helper kept next to the dispatcher so tests can pin the
 * fallback contract without round-tripping through the React component.
 */
export function normalizeCtaVariant(
	variant: EmailNotVerifiedDialog["cta_variant"] | undefined,
): EmailNotVerifiedCtaVariant {
	if (variant && ALLOWED_CTA_VARIANTS.has(variant)) return variant;
	return "primary";
}

/**
 * Preflight: at the moment a write affordance is clicked, decide whether
 * we should short-circuit by opening the §5.4 dialog ourselves instead of
 * making the user go through the post-422 detour.
 *
 * Returns `true` when the affordance should be BLOCKED (caller dispatches
 * the dialog and does NOT open the write UI). Returns `false` when the
 * write is allowed to proceed normally.
 *
 * Reviewer guidance (msg 58c38e78): "只在能可靠知道 emailVerifiedAt === 0
 * 的入口做 preflight dispatch；不知道状态的入口不要猜。" The contract is
 * therefore deliberately strict:
 *
 * - `null` (anonymous OR self-load failed OR caller has no reliable
 *   source) → DO NOT block. The api-client interceptor still backstops:
 *   if the Worker rejects, the dialog opens at that point. False negatives
 *   (we let an unverified user click the button) are recoverable; false
 *   positives (we block a verified user with stale state) are not.
 * - `0` → BLOCK. The Worker treats `0` as "never verified" — a logged-in
 *   user with that value can't write, and a server-side projection is
 *   the source of truth here, not the client.
 * - any positive number → DO NOT block (verified).
 *
 * Side effect: when blocking, this dispatches the EMAIL_NOT_VERIFIED
 * event with the canonical constant payload (no wire body to use yet).
 */
export function preflightEmailVerifiedBlock(emailVerifiedAt: number | null | undefined): boolean {
	if (emailVerifiedAt !== 0) return false;
	dispatchEmailNotVerified(pickDialogPayload(undefined));
	return true;
}
