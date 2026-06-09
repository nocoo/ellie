"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { registerUser } from "@/actions/auth";
import { CapWidget } from "@/components/cap-widget";
import { ForumLogo } from "@/components/forum/forum-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { checkUsernameAvailability } from "@/lib/forum-browser-api";
import { safeRedirect } from "@/lib/safe-redirect";
import { CAMPUS_OPTIONS, IDENTITY_OPTIONS } from "@/viewmodels/forum/profile-options";
import {
	buildRegisterProfile,
	canSubmitRegister,
	type PasswordStrength,
	passwordStrength,
	REGISTER_PROFILE_DEFAULTS,
	registerErrorMessage,
	validateBirthday,
	validateEmail,
	validateQQ,
	validateSite,
	validateUsername,
} from "@/viewmodels/forum/register";
import {
	AuthDivider,
	AuthErrorBanner,
	AuthHelpHint,
	AuthIdCard,
} from "../_components/auth-id-card";

const CAP_API_ENDPOINT = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ?? "";

// ---------------------------------------------------------------------------
// Username availability status
// ---------------------------------------------------------------------------

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "banned" | "invalid" | "error";

function usernameStatusText(status: UsernameStatus): string | null {
	switch (status) {
		case "available":
			return "可以使用";
		case "taken":
			return "已被注册";
		case "banned":
			return "包含违禁词";
		case "invalid":
			return "格式不正确";
		case "checking":
			return "检查中...";
		default:
			return null;
	}
}

function usernameStatusColor(status: UsernameStatus): string {
	switch (status) {
		case "available":
			return "text-success";
		case "taken":
		case "banned":
		case "invalid":
			return "text-destructive";
		case "checking":
			return "text-muted-foreground";
		default:
			return "";
	}
}

// ---------------------------------------------------------------------------
// Password strength bar
// ---------------------------------------------------------------------------

function StrengthBar({ strength }: { strength: PasswordStrength }) {
	if (strength === "none") return null;

	const config = {
		weak: { width: "w-1/3", color: "bg-destructive", label: "弱" },
		medium: { width: "w-2/3", color: "bg-forum-accent", label: "中" },
		strong: { width: "w-full", color: "bg-success", label: "强" },
	}[strength];

	return (
		<div className="mt-1.5 space-y-1">
			<div className="h-1 w-full rounded-full bg-muted">
				<div className={`h-full rounded-full transition-all ${config.width} ${config.color}`} />
			</div>
			<p className="text-xs text-muted-foreground">密码强度：{config.label}</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Select options
// ---------------------------------------------------------------------------

const GENDER_OPTIONS = [
	{ value: 0, label: "未设置" },
	{ value: 1, label: "男" },
	{ value: 2, label: "女" },
];

// CAMPUS_OPTIONS / IDENTITY_OPTIONS now live in viewmodels/forum/profile-options
// so register and profile-edit share the same source of truth.

// ---------------------------------------------------------------------------
// Posting conditions info
// ---------------------------------------------------------------------------

function PostingConditionsNote() {
	return (
		<div className="rounded-lg bg-muted/60 border border-border px-3.5 py-3 text-xs text-muted-foreground space-y-1.5">
			<p className="font-medium text-foreground/80">新用户须知</p>
			<ul className="list-disc list-inside space-y-0.5 leading-relaxed">
				<li>注册后需完成邮箱验证方可发帖</li>
				<li>请设置头像以获得完整的社区体验</li>
				<li>新账号受站点反滥用规则约束</li>
			</ul>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Shared register form core (used by both standalone & dialog)
// ---------------------------------------------------------------------------

interface RegisterFormCoreProps {
	/** "standalone" = /register page with AuthIdCard; "dialog" = wider 3-column */
	variant: "standalone" | "dialog";
	/** Called on successful registration (dialog closes itself) */
	onSuccess?: () => void;
}

function RegisterFormCore({ variant, onSuccess }: RegisterFormCoreProps) {
	const searchParams = useSearchParams();
	const callbackUrl = safeRedirect(searchParams.get("redirect"));

	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [email, setEmail] = useState("");
	const [capToken, setCapToken] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");

	// Profile fields
	const [gender, setGender] = useState(REGISTER_PROFILE_DEFAULTS.gender);
	const [campus, setCampus] = useState(REGISTER_PROFILE_DEFAULTS.campus);
	const [birthYear, setBirthYear] = useState(REGISTER_PROFILE_DEFAULTS.birthYear);
	const [birthMonth, setBirthMonth] = useState(REGISTER_PROFILE_DEFAULTS.birthMonth);
	const [birthDay, setBirthDay] = useState(REGISTER_PROFILE_DEFAULTS.birthDay);
	const [resideProvince, setResideProvince] = useState(REGISTER_PROFILE_DEFAULTS.resideProvince);
	const [resideCity, setResideCity] = useState(REGISTER_PROFILE_DEFAULTS.resideCity);
	const [graduateSchool, setGraduateSchool] = useState(REGISTER_PROFILE_DEFAULTS.graduateSchool);
	const [bio, setBio] = useState(REGISTER_PROFILE_DEFAULTS.bio);
	const [interest, setInterest] = useState(REGISTER_PROFILE_DEFAULTS.interest);
	const [qq, setQq] = useState(REGISTER_PROFILE_DEFAULTS.qq);
	const [site, setSite] = useState(REGISTER_PROFILE_DEFAULTS.site);
	const [signature, setSignature] = useState(REGISTER_PROFILE_DEFAULTS.signature);

	const capConfigured = Boolean(CAP_API_ENDPOINT);
	const formState = {
		username,
		password,
		confirmPassword,
		email,
		gender,
		campus,
		birthYear,
		birthMonth,
		birthDay,
		resideProvince,
		resideCity,
		graduateSchool,
		bio,
		interest,
		qq,
		site,
		signature,
	};
	const canSubmit = canSubmitRegister(formState) && capConfigured && Boolean(capToken);
	const strength = passwordStrength(password);
	const usernameError = username.trim() ? validateUsername(username) : null;
	const emailError = email ? validateEmail(email) : null;
	const passwordMismatch = confirmPassword && password !== confirmPassword;
	const birthdayError = validateBirthday(birthYear, birthMonth, birthDay);
	const qqError = validateQQ(qq);
	const siteError = validateSite(site);

	// Debounced username availability check
	useEffect(() => {
		const localError = validateUsername(username);
		if (localError) {
			setUsernameStatus("idle");
			return;
		}

		setUsernameStatus("checking");
		const timer = setTimeout(async () => {
			const data = await checkUsernameAvailability(username.trim());
			if (data.available) {
				setUsernameStatus("available");
			} else if (data.reason === "error") {
				setUsernameStatus("error");
			} else {
				setUsernameStatus((data.reason as UsernameStatus) ?? "taken");
			}
		}, 500);

		return () => clearTimeout(timer);
	}, [username]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit || loading) return;

		setLoading(true);
		setError(null);

		try {
			const result = await registerUser(
				username.trim(),
				password,
				email.trim(),
				buildRegisterProfile(formState),
			);

			if ("error" in result) {
				setError(registerErrorMessage(result.error) ?? "注册失败");
				return;
			}

			// Registration success → auto-login via signIn
			const { signIn } = await import("next-auth/react");
			const signInResult = await signIn("credentials", {
				username: username.trim(),
				password,
				redirect: false,
			});

			if (signInResult?.error) {
				// Registration succeeded but auto-login failed — redirect to login
				window.location.href = `/login?redirect=${encodeURIComponent(callbackUrl)}`;
			} else if (signInResult?.ok) {
				if (onSuccess) {
					onSuccess();
				} else {
					window.location.href = callbackUrl;
				}
			}
		} catch {
			setError("网络错误，请重试");
		} finally {
			setLoading(false);
		}
	};

	// ---------------------------------------------------------------------------
	// Field fragments
	// ---------------------------------------------------------------------------

	/** Account fields: username, password, confirm, email, birthday */
	const accountFields = (
		<>
			{/* Username */}
			<div className="space-y-2">
				<Label htmlFor="reg-username" className="text-sm">
					用户名
				</Label>
				<Input
					id="reg-username"
					type="text"
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					placeholder="2-15 个字符"
					disabled={loading}
					autoComplete="username"
					className="h-[58px] text-base"
				/>
				{usernameError && username.trim() && (
					<p className="text-xs text-destructive">{usernameError}</p>
				)}
				{!usernameError && usernameStatusText(usernameStatus) && (
					<p className={`text-xs ${usernameStatusColor(usernameStatus)}`}>
						{usernameStatusText(usernameStatus)}
					</p>
				)}
			</div>

			{/* Password */}
			<div className="space-y-2">
				<Label htmlFor="reg-password" className="text-sm">
					密码
				</Label>
				<Input
					id="reg-password"
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="至少 6 个字符"
					disabled={loading}
					autoComplete="new-password"
					className="h-[58px] text-base"
				/>
				<StrengthBar strength={strength} />
			</div>

			{/* Confirm Password */}
			<div className="space-y-2">
				<Label htmlFor="reg-confirmPassword" className="text-sm">
					确认密码
				</Label>
				<Input
					id="reg-confirmPassword"
					type="password"
					value={confirmPassword}
					onChange={(e) => setConfirmPassword(e.target.value)}
					placeholder="再次输入密码"
					disabled={loading}
					autoComplete="new-password"
					className="h-[58px] text-base"
				/>
				{passwordMismatch && <p className="text-xs text-destructive">两次输入的密码不一致</p>}
			</div>

			{/* Email */}
			<div className="space-y-2">
				<Label htmlFor="reg-email" className="text-sm">
					邮箱
				</Label>
				<Input
					id="reg-email"
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="your@email.com"
					disabled={loading}
					autoComplete="email"
					className="h-[58px] text-base"
				/>
				{emailError && <p className="text-xs text-destructive">{emailError}</p>}
			</div>

			{/* Birthday */}
			<div className="space-y-2">
				<Label className="text-sm">出生日期</Label>
				<div className="flex gap-2">
					<Input
						type="text"
						value={birthYear}
						onChange={(e) => setBirthYear(e.target.value)}
						placeholder="年"
						disabled={loading}
						className="h-[58px] text-base flex-1"
						inputMode="numeric"
					/>
					<Input
						type="text"
						value={birthMonth}
						onChange={(e) => setBirthMonth(e.target.value)}
						placeholder="月"
						disabled={loading}
						className="h-[58px] text-base w-16"
						inputMode="numeric"
					/>
					<Input
						type="text"
						value={birthDay}
						onChange={(e) => setBirthDay(e.target.value)}
						placeholder="日"
						disabled={loading}
						className="h-[58px] text-base w-16"
						inputMode="numeric"
					/>
				</div>
				{birthdayError && (birthYear || birthMonth || birthDay) && (
					<p className="text-xs text-destructive">{birthdayError}</p>
				)}
			</div>
		</>
	);

	/** Education fields: identity type (graduateSchool), campus */
	const educationFields = (
		<>
			{/* Identity type (stored as graduateSchool) */}
			<div className="space-y-2">
				<Label htmlFor="reg-identity" className="text-sm">
					身份类型
				</Label>
				<Select
					id="reg-identity"
					options={IDENTITY_OPTIONS}
					value={graduateSchool}
					onChange={(e) => setGraduateSchool(e.target.value)}
					disabled={loading}
					className="h-[58px] text-base"
				/>
			</div>

			{/* Campus */}
			<div className="space-y-2">
				<Label htmlFor="reg-campus" className="text-sm">
					校区
				</Label>
				<Select
					id="reg-campus"
					options={CAMPUS_OPTIONS}
					value={campus}
					onChange={(e) => setCampus(e.target.value)}
					disabled={loading}
					className="h-[58px] text-base"
				/>
			</div>
		</>
	);

	/** Personal fields: gender, residence, bio, interest, qq, site, signature */
	const personalFields = (
		<>
			{/* Gender */}
			<div className="space-y-2">
				<Label htmlFor="reg-gender" className="text-sm">
					性别
				</Label>
				<Select
					id="reg-gender"
					options={GENDER_OPTIONS}
					value={gender}
					onChange={(e) => setGender(Number(e.target.value))}
					disabled={loading}
					className="h-[58px] text-base"
				/>
			</div>

			{/* Residence */}
			<div className="space-y-2">
				<Label className="text-sm">现居住地</Label>
				<div className="flex gap-2">
					<Input
						type="text"
						value={resideProvince}
						onChange={(e) => setResideProvince(e.target.value)}
						placeholder="省份"
						disabled={loading}
						className="h-[58px] text-base flex-1"
					/>
					<Input
						type="text"
						value={resideCity}
						onChange={(e) => setResideCity(e.target.value)}
						placeholder="城市"
						disabled={loading}
						className="h-[58px] text-base flex-1"
					/>
				</div>
			</div>

			{/* Bio */}
			<div className="space-y-2">
				<Label htmlFor="reg-bio" className="text-sm">
					个人简介
				</Label>
				<Textarea
					id="reg-bio"
					value={bio}
					onChange={(e) => setBio(e.target.value)}
					placeholder="简单介绍自己"
					disabled={loading}
					rows={2}
					className="text-sm"
				/>
			</div>

			{/* Interest */}
			<div className="space-y-2">
				<Label htmlFor="reg-interest" className="text-sm">
					爱好特长
				</Label>
				<Input
					id="reg-interest"
					type="text"
					value={interest}
					onChange={(e) => setInterest(e.target.value)}
					placeholder="爱好特长"
					disabled={loading}
					className="h-[58px] text-base"
				/>
			</div>

			{/* QQ */}
			<div className="space-y-2">
				<Label htmlFor="reg-qq" className="text-sm">
					QQ
				</Label>
				<Input
					id="reg-qq"
					type="text"
					value={qq}
					onChange={(e) => setQq(e.target.value)}
					placeholder="QQ 号码"
					disabled={loading}
					className="h-[58px] text-base"
					inputMode="numeric"
				/>
				{qqError && <p className="text-xs text-destructive">{qqError}</p>}
			</div>

			{/* Site */}
			<div className="space-y-2">
				<Label htmlFor="reg-site" className="text-sm">
					个人网站
				</Label>
				<Input
					id="reg-site"
					type="url"
					value={site}
					onChange={(e) => setSite(e.target.value)}
					placeholder="https://..."
					disabled={loading}
					className="h-[58px] text-base"
				/>
				{siteError && <p className="text-xs text-destructive">{siteError}</p>}
			</div>
			<div className="space-y-2">
				<Label htmlFor="reg-signature" className="text-sm">
					个性签名
				</Label>
				<Textarea
					id="reg-signature"
					value={signature}
					onChange={(e) => setSignature(e.target.value)}
					placeholder="一句话签名"
					disabled={loading}
					rows={2}
					className="text-sm"
				/>
			</div>
		</>
	);

	/** CAPTCHA widget in a 58px container for visual alignment.
	 *  Fail-closed: when CAP is not configured, show an error banner instead
	 *  of silently allowing registration. */
	const captchaField = capConfigured ? (
		<div className="flex items-center justify-center h-[58px]">
			<CapWidget
				apiEndpoint={CAP_API_ENDPOINT}
				onSolve={setCapToken}
				onError={() => setCapToken("")}
			/>
		</div>
	) : (
		<AuthErrorBanner message="人机验证服务未就绪，暂时无法注册，请稍后再试或联系管理员。" />
	);

	// ---------------------------------------------------------------------------
	// Dialog variant — wide 3-column layout
	// ---------------------------------------------------------------------------

	if (variant === "dialog") {
		return (
			<form onSubmit={handleSubmit} className="space-y-5">
				{error && <AuthErrorBanner message={error} />}

				<div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
					{/* Left column — Account */}
					<div className="space-y-4">
						<p className="text-sm font-medium text-foreground/80 border-b border-border pb-1.5">
							账号信息
						</p>
						{accountFields}
					</div>

					{/* Middle column — Education */}
					<div className="space-y-4">
						<p className="text-sm font-medium text-foreground/80 border-b border-border pb-1.5">
							教育信息
						</p>
						{educationFields}
					</div>

					{/* Right column — Personal */}
					<div className="space-y-4">
						<p className="text-sm font-medium text-foreground/80 border-b border-border pb-1.5">
							个人信息（选填）
						</p>
						{personalFields}
					</div>
				</div>

				<PostingConditionsNote />

				{/* CAPTCHA + Submit — side by side on wide screens, stacked on narrow */}
				<div className="flex flex-col sm:flex-row gap-3">
					{captchaField}
					<Button
						type="submit"
						disabled={!canSubmit || loading}
						className="h-[58px] text-base flex-1"
					>
						{loading ? "注册中..." : "创建账号"}
					</Button>
				</div>
			</form>
		);
	}

	// ---------------------------------------------------------------------------
	// Standalone variant — narrow single-column inside AuthIdCard
	// ---------------------------------------------------------------------------

	const year = new Date().getFullYear();

	return (
		<AuthIdCard topCenter={year}>
			{/* Logo */}
			<div className="flex justify-center mb-4">
				<ForumLogo height={40} />
			</div>

			<p className="text-lg font-semibold text-foreground text-center">加入我们</p>
			<p className="mt-1 text-sm text-muted-foreground text-center">创建您的账号</p>

			<form onSubmit={handleSubmit} className="mt-5 space-y-4">
				{/* Error */}
				{error && <AuthErrorBanner message={error} />}

				{accountFields}

				{/* Education fields — required, always visible */}
				<div className="space-y-4">
					<p className="text-sm font-medium text-foreground/80 border-b border-border pb-1.5">
						教育信息
					</p>
					{educationFields}
				</div>

				{/* Personal fields — collapsible, optional */}
				<details className="group">
					<summary className="cursor-pointer text-sm font-medium text-foreground/80 border-b border-border pb-1.5 mb-3 select-none list-none flex items-center justify-between">
						个人信息（选填）
						<span className="text-xs text-muted-foreground group-open:rotate-180 transition-transform">
							▼
						</span>
					</summary>
					<div className="space-y-4">{personalFields}</div>
				</details>

				<PostingConditionsNote />

				{/* CAPTCHA above submit */}
				{captchaField}

				{/* Submit */}
				<Button
					type="submit"
					disabled={!canSubmit || loading}
					className="w-full h-[58px] text-base"
				>
					{loading ? "注册中..." : "创建账号"}
				</Button>
			</form>

			<AuthDivider />

			{/* Login link */}
			<a href="/login" className="block">
				<Button variant="outline" className="w-full h-[58px] text-base">
					已有账号，去登录
				</Button>
			</a>

			{/* Contact-admin hint — only rendered after CAPTCHA solve to keep
			    the email hidden from naive scrapers. */}
			<AuthHelpHint visible={capConfigured && Boolean(capToken)} />
		</AuthIdCard>
	);
}

// ---------------------------------------------------------------------------
// Standalone register form (used by /register page)
// ---------------------------------------------------------------------------

export default function RegisterForm() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center">
					<p className="text-muted-foreground">Loading...</p>
				</div>
			}
		>
			<RegisterFormCore variant="standalone" />
		</Suspense>
	);
}

// ---------------------------------------------------------------------------
// Dialog variant export (used by login page)
// ---------------------------------------------------------------------------

export function RegisterFormDialog({ onSuccess }: { onSuccess?: () => void }) {
	return (
		<Suspense
			fallback={
				<div className="flex items-center justify-center py-12">
					<p className="text-muted-foreground">Loading...</p>
				</div>
			}
		>
			<RegisterFormCore variant="dialog" onSuccess={onSuccess} />
		</Suspense>
	);
}
