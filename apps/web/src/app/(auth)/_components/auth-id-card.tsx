import { BookOpen, GraduationCap, MessageCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { ForumLogo } from "@/components/forum/forum-logo";
import { HexlyLink } from "@/components/header-links";
import { ThemeToggle } from "@/components/theme-toggle";

interface AuthIdCardProps {
	topCenter: ReactNode;
	children: ReactNode;
}

export function AuthIdCard({ topCenter, children }: AuthIdCardProps) {
	return (
		<div className="relative flex min-h-dvh flex-col bg-background">
			<div className="flex items-center justify-end gap-0.5 px-4 pt-3 sm:px-6">
				<HexlyLink />
				<ThemeToggle />
			</div>
			<main className="flex flex-1 items-center justify-center px-4 pb-8 pt-3 sm:px-6 sm:pb-12">
				<div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-card shadow-sm lg:grid-cols-[0.8fr_1.2fr]">
					<div className="relative flex flex-col overflow-hidden bg-[#123a56] p-6 text-white sm:p-8 lg:p-10">
						<div className="relative z-10 flex items-center justify-between gap-4">
							<Link href="/" aria-label="同济网论坛首页">
								<ForumLogo height={32} variant="dark" />
							</Link>
							<span className="text-xs tracking-wide text-white/65">{topCenter}</span>
						</div>
						<div className="relative z-10 hidden flex-1 flex-col justify-center py-16 lg:flex">
							<div className="mb-6 flex size-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10">
								<GraduationCap className="size-6" aria-hidden="true" />
							</div>
							<p className="text-3xl font-semibold leading-snug tracking-tight">
								校园的日常，
								<br />
								在这里继续。
							</p>
							<p className="mt-4 max-w-xs text-sm leading-7 text-white/75">
								分享见闻，交流所学。和同学、校友一起，记录每一个值得留下的瞬间。
							</p>
							<div className="mt-8 flex flex-wrap gap-2 text-xs text-white/85">
								<span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2">
									<MessageCircle className="size-3.5" aria-hidden="true" />
									校园交流
								</span>
								<span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2">
									<BookOpen className="size-3.5" aria-hidden="true" />
									经验分享
								</span>
							</div>
						</div>
						<div
							className="pointer-events-none absolute -bottom-24 -right-24 hidden size-80 rounded-full border-[40px] border-white/5 lg:block"
							aria-hidden="true"
						/>
					</div>
					<div className="flex min-w-0 flex-col justify-center p-5 sm:p-8 lg:p-10">
						{children}
						<p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
							<ShieldCheck className="size-3.5" aria-hidden="true" />
							请使用自己的账号登录
						</p>
					</div>
				</div>
			</main>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Small inline helpers — kept in the same file because each is only used
// from the two auth forms and stays under ~15 lines.
// ---------------------------------------------------------------------------

export function AuthErrorBanner({ message }: { message: string }) {
	return (
		<div
			role="alert"
			className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm leading-relaxed text-destructive"
		>
			<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>{message}</span>
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
