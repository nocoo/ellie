// app/(auth)/_components/auth-id-card.tsx — Auth page chrome shared by
// login and register forms. Wraps a fullscreen background (radial glow +
// theme toggle) around a fixed-width "ID badge" card with primary top
// strip (punch hole + topCenter slot + barcode) and secondary bottom strip
// ("安全连接"). Children render inside the form area.
//
// Inline radial glow / boxShadow are migrated verbatim from the original
// login-form / register-form so visual output stays identical.

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthBarcode } from "./auth-barcode";

interface AuthIdCardProps {
	/** Centered text in the primary top strip (e.g. "Since 2002" or "{year}"). */
	topCenter: ReactNode;
	children: ReactNode;
}

const RADIAL_GLOW_BG = [
	"radial-gradient(ellipse 70% 55% at 50% 50%,",
	"hsl(var(--foreground) / 0.045) 0%,",
	"hsl(var(--foreground) / 0.04) 10%,",
	"hsl(var(--foreground) / 0.032) 20%,",
	"hsl(var(--foreground) / 0.025) 32%,",
	"hsl(var(--foreground) / 0.018) 45%,",
	"hsl(var(--foreground) / 0.011) 58%,",
	"hsl(var(--foreground) / 0.006) 72%,",
	"hsl(var(--foreground) / 0.002) 86%,",
	"transparent 100%)",
].join(" ");

const ID_CARD_BOX_SHADOW_LIGHT = [
	"0 1px 2px rgba(0,0,0,0.06)",
	"0 4px 8px rgba(0,0,0,0.04)",
	"0 12px 24px rgba(0,0,0,0.06)",
	"0 24px 48px rgba(0,0,0,0.04)",
	"0 0 0 0.5px rgba(0,0,0,0.02)",
	"0 0 60px rgba(0,0,0,0.03)",
].join(", ");

// Dark variant — keep deep black drop to lift the card off the dark
// background, plus a very faint white edge/ambient glow. Stays subtle so
// the card never reads as a glowing white-outlined panel.
const ID_CARD_BOX_SHADOW_DARK = [
	"0 0 0 1px rgba(255,255,255,0.04)",
	"0 12px 32px rgba(0,0,0,0.35)",
	"0 0 48px rgba(255,255,255,0.025)",
].join(", ");

export function AuthIdCard({ topCenter, children }: AuthIdCardProps) {
	return (
		<div
			className="relative flex min-h-screen flex-col bg-background overflow-hidden"
			style={
				{
					"--auth-id-card-shadow-light": ID_CARD_BOX_SHADOW_LIGHT,
					"--auth-id-card-shadow-dark": ID_CARD_BOX_SHADOW_DARK,
				} as CSSProperties
			}
		>
			{/* Radial glow */}
			<div
				className="pointer-events-none absolute inset-0"
				style={{ background: RADIAL_GLOW_BG }}
			/>

			{/* Theme toggle */}
			<div className="absolute top-4 right-4 z-10">
				<ThemeToggle />
			</div>

			{/* Centered content */}
			<div className="flex flex-1 items-center justify-center p-4">
				{/* Badge card — boxShadow flips with the .dark theme via CSS var */}
				<div className="relative w-[308px] overflow-hidden rounded-2xl bg-card flex flex-col ring-1 ring-black/[0.08] dark:ring-white/[0.06] shadow-[var(--auth-id-card-shadow-light)] dark:shadow-[var(--auth-id-card-shadow-dark)]">
					{/* Header strip with decorations */}
					<div className="bg-primary px-5 py-3">
						<div className="flex items-center justify-between">
							{/* Punch hole */}
							<div
								className="h-3 w-6 rounded-full bg-background/80"
								style={{
									boxShadow:
										"inset 0 1px 2px rgba(0,0,0,0.35), inset 0 -0.5px 1px rgba(255,255,255,0.1)",
								}}
							/>
							<span className="text-xs font-medium text-primary-foreground/60 tracking-wider">
								{topCenter}
							</span>
							<div className="h-4">
								<AuthBarcode />
							</div>
						</div>
					</div>

					{/* Form content */}
					<div className="flex flex-1 flex-col px-6 pt-6 pb-5">{children}</div>

					{/* Footer strip */}
					<div className="flex items-center justify-center border-t border-border bg-secondary/50 py-2">
						<div className="flex items-center gap-1">
							<div className="h-1 w-1 rounded-full bg-success/70 animate-pulse" />
							<span className="text-xs text-muted-foreground/60 tracking-wider">安全连接</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Small inline helpers — kept in the same file because each is only used
// from the two auth forms and stays under ~15 lines.
// ---------------------------------------------------------------------------

export function AuthErrorBanner({ message }: { message: string }) {
	return (
		<div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive text-center">
			{message}
		</div>
	);
}

export function AuthDivider({ label = "或" }: { label?: string }) {
	return (
		<div className="my-5 flex items-center gap-3">
			<div className="h-px flex-1 bg-border" />
			<span className="text-xs text-muted-foreground">{label}</span>
			<div className="h-px flex-1 bg-border" />
		</div>
	);
}

// ---------------------------------------------------------------------------
// AuthHelpHint — Contact-admin row gated on CAPTCHA success.
//
// Anti-scrape design (two layers):
//
//   1. **Render gate** — the row is only mounted when `visible === true`,
//      which the caller flips after the Cap.js widget emits a non-empty
//      token. Bots that just GET the SSR HTML never see it because CAP
//      solve is a client-only side effect.
//
//   2. **Bundle obfuscation** — the email address is stored only as a
//      `Uint8Array` of character codes. A statically inlined string
//      concatenation can be constant-folded by Next/SWC into the literal
//      that appears verbatim in the compiled client chunk. Storing the
//      bytes in a typed array and reconstructing them at runtime via
//      `String.fromCharCode(...)` is opaque to the optimizer — the full
//      literal never appears in the source or the bundle. For extra
//      safety we defer assembly to a `useEffect` so the string only
//      materializes on the client after mount, gated by `visible`.
//
// Caller wires `visible={Boolean(capToken)}` (or simply omits when CAP is
// disabled, in which case the hint stays hidden).
// ---------------------------------------------------------------------------

// Character codes for the help mailbox. Stored as a TypedArray so SWC has
// no reason to fold this into a string literal at build time.
const HELP_EMAIL_CODES = new Uint8Array([
	104, 101, 108, 112, 64, 116, 111, 110, 103, 106, 105, 46, 110, 101, 116,
]);

function buildHelpEmail(): string {
	// Spread keeps SWC from seeing a constant array whose contents it
	// could pre-compute; the final string is built on the client at call
	// time.
	return String.fromCharCode(...HELP_EMAIL_CODES);
}

export function AuthHelpHint({ visible }: { visible: boolean }) {
	// Assemble the email on the client only, on mount. Together with the
	// render gate this means the literal address never exists in the
	// shipped bundle and only materializes after a real user reaches this
	// branch.
	const [email, setEmail] = useState("");
	useEffect(() => {
		if (visible && !email) setEmail(buildHelpEmail());
	}, [visible, email]);

	if (!visible || !email) return null;
	return (
		<p className="mt-4 text-center text-xs text-muted-foreground" data-testid="auth-help-hint">
			如遇问题，请发邮件到:{" "}
			<a href={`mailto:${email}`} className="text-primary hover:underline">
				{email}
			</a>
		</p>
	);
}
