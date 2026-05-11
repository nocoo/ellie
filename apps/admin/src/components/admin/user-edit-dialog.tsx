"use client";

import type { User, UserUpdate } from "@/viewmodels/admin/users";
import { Button } from "@ellie/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ellie/ui";
import { Input } from "@ellie/ui";
import { Label } from "@ellie/ui";
import { Select } from "@ellie/ui";
import { cn } from "@ellie/ui/utils";
import { Save, User as UserIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { AdminInlineMessage } from "./admin-inline-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: User | null;
	loading?: boolean;
	error?: string | null;
	onSave: (id: number, data: UserUpdate) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
	{ value: 0, label: "正常" },
	{ value: -1, label: "已封禁" },
	{ value: -2, label: "已归档" },
];

const ROLE_OPTIONS = [
	{ value: 0, label: "普通会员" },
	{ value: 1, label: "管理员" },
	{ value: 2, label: "超级版主" },
	{ value: 3, label: "版主" },
];

/**
 * Tailwind classes applied to the IP `<Input>` cells.
 *
 * IPv6 addresses are up to ~39 characters; before this rewrite the dialog
 * placed both IPs in a fixed `grid-cols-2 gap-4` inside a 520px container,
 * causing the value to overflow the half-column. We now render IPs in a
 * single column and force overflow wrapping with `break-all` + `min-w-0`.
 *
 * Exported for tests (see admin/tests/unit/components/user-edit-dialog.test.ts)
 * so a future refactor cannot silently regress the IPv6 wrap behaviour.
 */
export const IP_INPUT_CLASSNAME = "font-mono w-full min-w-0 break-all";

// ---------------------------------------------------------------------------
// Form state — reducer over the full editable surface so we don't accumulate
// 35+ useState hooks (Reviewer-B point #6: lower the chance of dropping a
// field on add/rename).
// ---------------------------------------------------------------------------

interface FormState {
	// Identity
	username: string;
	email: string;
	avatar: string;
	avatarPath: string;
	emailNormalized: string;
	emailVerifiedAt: number;
	emailChangedAt: number;
	// Permissions
	status: number;
	role: number;
	// Counters
	credits: number;
	coins: number;
	threads: number;
	posts: number;
	digestPosts: number;
	olTime: number;
	lastActivity: number;
	regDate: number;
	lastLogin: number;
	// Group decoration
	groupTitle: string;
	groupStars: number;
	groupColor: string;
	customTitle: string;
	signature: string;
	// Profile
	gender: number;
	birthYear: number;
	birthMonth: number;
	birthDay: number;
	resideProvince: string;
	resideCity: string;
	graduateSchool: string;
	bio: string;
	interest: string;
	qq: string;
	site: string;
	campus: string;
	// IP
	regIp: string;
	lastIp: string;
}

type FormAction =
	| { type: "set"; field: keyof FormState; value: string | number }
	| { type: "reset"; user: User };

function blankForm(): FormState {
	return {
		username: "",
		email: "",
		avatar: "",
		avatarPath: "",
		emailNormalized: "",
		emailVerifiedAt: 0,
		emailChangedAt: 0,
		status: 0,
		role: 0,
		credits: 0,
		coins: 0,
		threads: 0,
		posts: 0,
		digestPosts: 0,
		olTime: 0,
		lastActivity: 0,
		regDate: 0,
		lastLogin: 0,
		groupTitle: "",
		groupStars: 0,
		groupColor: "",
		customTitle: "",
		signature: "",
		gender: 0,
		birthYear: 0,
		birthMonth: 0,
		birthDay: 0,
		resideProvince: "",
		resideCity: "",
		graduateSchool: "",
		bio: "",
		interest: "",
		qq: "",
		site: "",
		campus: "",
		regIp: "",
		lastIp: "",
	};
}

// Helpers split out of fromUser() to keep its cyclomatic complexity under
// the biome limit (default 25). Each helper handles one section so adding
// a new field there does not push the dispatcher's branch count.

function identityFields(u: User) {
	return {
		username: u.username,
		email: u.email,
		avatar: u.avatar,
		avatarPath: u.avatarPath ?? "",
		emailNormalized: u.emailNormalized ?? "",
		emailVerifiedAt: u.emailVerifiedAt ?? 0,
		emailChangedAt: u.emailChangedAt ?? 0,
	};
}

function counterFields(u: User) {
	return {
		credits: u.credits,
		coins: u.coins,
		threads: u.threads,
		posts: u.posts,
		digestPosts: u.digestPosts ?? 0,
		olTime: u.olTime ?? 0,
		lastActivity: u.lastActivity ?? 0,
		regDate: u.regDate,
		lastLogin: u.lastLogin,
	};
}

function groupFields(u: User) {
	return {
		groupTitle: u.groupTitle ?? "",
		groupStars: u.groupStars ?? 0,
		groupColor: u.groupColor ?? "",
		customTitle: u.customTitle ?? "",
		signature: u.signature ?? "",
	};
}

function profileFields(u: User) {
	return {
		gender: u.gender ?? 0,
		birthYear: u.birthYear ?? 0,
		birthMonth: u.birthMonth ?? 0,
		birthDay: u.birthDay ?? 0,
		resideProvince: u.resideProvince ?? "",
		resideCity: u.resideCity ?? "",
		graduateSchool: u.graduateSchool ?? "",
		bio: u.bio ?? "",
		interest: u.interest ?? "",
		qq: u.qq ?? "",
		site: u.site ?? "",
		campus: u.campus ?? "",
	};
}

function fromUser(u: User): FormState {
	return {
		...blankForm(),
		...identityFields(u),
		status: u.status,
		role: u.role,
		...counterFields(u),
		...groupFields(u),
		...profileFields(u),
		regIp: u.regIp ?? "",
		lastIp: u.lastIp ?? "",
	};
}

function reducer(state: FormState, action: FormAction): FormState {
	switch (action.type) {
		case "set":
			return { ...state, [action.field]: action.value };
		case "reset":
			return fromUser(action.user);
	}
}

// ---------------------------------------------------------------------------
// Small input wrappers
// ---------------------------------------------------------------------------

function StringField(props: {
	id: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	disabled?: boolean;
	placeholder?: string;
}) {
	return (
		<div className="grid gap-2 min-w-0">
			<Label htmlFor={props.id}>{props.label}</Label>
			<Input
				id={props.id}
				value={props.value}
				onChange={(e) => props.onChange(e.target.value)}
				placeholder={props.placeholder}
				disabled={props.disabled}
			/>
		</div>
	);
}

function NumberField(props: {
	id: string;
	label: string;
	value: number;
	onChange: (v: number) => void;
	disabled?: boolean;
	hint?: string;
}) {
	return (
		<div className="grid gap-2 min-w-0">
			<Label htmlFor={props.id} className="flex items-center justify-between gap-2">
				<span>{props.label}</span>
				{props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
			</Label>
			<Input
				id={props.id}
				type="number"
				value={Number.isFinite(props.value) ? props.value : 0}
				onChange={(e) => {
					const n = Number(e.target.value);
					props.onChange(Number.isFinite(n) ? n : 0);
				}}
				disabled={props.disabled}
			/>
		</div>
	);
}

function TextareaField(props: {
	id: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	disabled?: boolean;
	rows?: number;
}) {
	return (
		<div className="grid gap-2 min-w-0">
			<Label htmlFor={props.id}>{props.label}</Label>
			<textarea
				id={props.id}
				value={props.value}
				onChange={(e) => props.onChange(e.target.value)}
				disabled={props.disabled}
				rows={props.rows ?? 3}
				className={cn(
					"flex w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm",
					"shadow-sm placeholder:text-muted-foreground focus-visible:outline-none",
					"focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
				)}
			/>
		</div>
	);
}

function Section(props: { title: string; children: React.ReactNode; muted?: boolean }) {
	return (
		<div className="space-y-4">
			<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
				<span
					className={cn("h-1 w-1 rounded-full", props.muted ? "bg-muted-foreground" : "bg-primary")}
				/>
				{props.title}
			</h3>
			{props.children}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserEditDialog({
	open,
	onOpenChange,
	user,
	loading = false,
	error,
	onSave,
}: UserEditDialogProps) {
	const [form, dispatch] = useReducer(reducer, undefined as never, blankForm);

	// Sync form when user changes
	useEffect(() => {
		if (user) dispatch({ type: "reset", user });
	}, [user]);

	const set = useCallback(
		(field: keyof FormState) => (value: string | number) => {
			dispatch({ type: "set", field, value });
		},
		[],
	);

	const handleSave = useCallback(() => {
		if (!user || loading) return;
		// Send the full form so admins can clear strings ("") deliberately.
		// `purgedAt` / `purgedBy` are NOT in the form — owned by the purge
		// endpoint, never edited via PATCH.
		const payload: UserUpdate = {
			username: form.username,
			email: form.email,
			avatar: form.avatar,
			avatarPath: form.avatarPath,
			emailNormalized: form.emailNormalized,
			emailVerifiedAt: form.emailVerifiedAt,
			emailChangedAt: form.emailChangedAt,
			status: form.status,
			role: form.role,
			credits: form.credits,
			coins: form.coins,
			threads: form.threads,
			posts: form.posts,
			digestPosts: form.digestPosts,
			olTime: form.olTime,
			lastActivity: form.lastActivity,
			regDate: form.regDate,
			lastLogin: form.lastLogin,
			groupTitle: form.groupTitle,
			groupStars: form.groupStars,
			groupColor: form.groupColor,
			customTitle: form.customTitle,
			signature: form.signature,
			gender: form.gender,
			birthYear: form.birthYear,
			birthMonth: form.birthMonth,
			birthDay: form.birthDay,
			resideProvince: form.resideProvince,
			resideCity: form.resideCity,
			graduateSchool: form.graduateSchool,
			bio: form.bio,
			interest: form.interest,
			qq: form.qq,
			site: form.site,
			campus: form.campus,
			regIp: form.regIp,
			lastIp: form.lastIp,
		};
		onSave(user.id, payload);
	}, [user, loading, onSave, form]);

	const statusColor = useMemo(
		() =>
			form.status === 0
				? "text-success"
				: form.status === -1
					? "text-destructive"
					: "text-muted-foreground",
		[form.status],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(
					// Wide enough for IPv6 single-column + two-column form grid on lg.
					"w-[calc(100vw-2rem)] sm:w-[640px] lg:w-[860px] sm:max-w-[860px]",
					"max-h-[85vh] overflow-hidden flex flex-col",
					"rounded-xl p-0",
				)}
				showCloseButton={false}
			>
				{/* Header */}
				<DialogHeader className="px-5 pt-5 pb-4 border-b border-border/50">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
								<UserIcon className="h-5 w-5 text-primary" />
							</div>
							<div>
								<DialogTitle className="text-lg">编辑用户</DialogTitle>
								<DialogDescription className="text-xs mt-0.5">
									{user ? `UID: ${user.id}` : "用户信息"}
								</DialogDescription>
							</div>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => onOpenChange(false)}
							disabled={loading}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className="sr-only">关闭</span>
							<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
								<path
									d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
									fill="currentColor"
									fillRule="evenodd"
									clipRule="evenodd"
								/>
							</svg>
						</Button>
					</div>
				</DialogHeader>

				{/* Error display */}
				{error && <AdminInlineMessage variant="error" text={error} className="mx-5 mt-4" />}

				{/* Form */}
				<div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
					<Section title="基本信息">
						<div className="grid gap-4 lg:grid-cols-2">
							<StringField
								id="edit-username"
								label="用户名"
								value={form.username}
								onChange={set("username")}
								disabled={loading}
								placeholder="输入用户名"
							/>
							{/* type="text" not "email" — admins must be able to edit malformed legacy values */}
							<StringField
								id="edit-email"
								label="邮箱地址"
								value={form.email}
								onChange={set("email")}
								disabled={loading}
								placeholder="user@example.com"
							/>
							<StringField
								id="edit-emailNormalized"
								label="邮箱（normalized）"
								value={form.emailNormalized}
								onChange={set("emailNormalized")}
								disabled={loading}
								placeholder="lowercase trimmed (UNIQUE if non-empty)"
							/>
							<NumberField
								id="edit-emailVerifiedAt"
								label="邮箱验证时间"
								value={form.emailVerifiedAt}
								onChange={set("emailVerifiedAt")}
								disabled={loading}
								hint="unix sec, 0=未验证"
							/>
							<NumberField
								id="edit-emailChangedAt"
								label="邮箱最近修改"
								value={form.emailChangedAt}
								onChange={set("emailChangedAt")}
								disabled={loading}
								hint="unix sec"
							/>
							<div className="grid gap-2 min-w-0">
								<Label htmlFor="edit-avatar">头像链接</Label>
								<div className="flex items-center gap-3 min-w-0">
									{form.avatar && (
										<img
											src={form.avatar}
											alt="Avatar preview"
											className="h-10 w-10 shrink-0 rounded-lg object-cover border border-border"
											onError={(e) => {
												e.currentTarget.style.display = "none";
											}}
										/>
									)}
									<Input
										id="edit-avatar"
										value={form.avatar}
										onChange={(e) => set("avatar")(e.target.value)}
										placeholder="https://..."
										disabled={loading}
										className="flex-1 min-w-0"
									/>
								</div>
							</div>
							<StringField
								id="edit-avatarPath"
								label="头像存储路径"
								value={form.avatarPath}
								onChange={set("avatarPath")}
								disabled={loading}
								placeholder="avatars/<uuid>.jpg"
							/>
						</div>
					</Section>

					<Section title="权限设置">
						<div className="grid gap-4 lg:grid-cols-2">
							<div className="grid gap-2 min-w-0">
								<Label htmlFor="edit-status" className="flex items-center justify-between">
									<span>账号状态</span>
									<span className={cn("text-xs", statusColor)}>
										{STATUS_OPTIONS.find((o) => o.value === form.status)?.label}
									</span>
								</Label>
								<Select
									id="edit-status"
									value={form.status}
									onChange={(e) => set("status")(Number(e.target.value))}
									options={STATUS_OPTIONS}
									disabled={loading}
								/>
							</div>
							<div className="grid gap-2 min-w-0">
								<Label htmlFor="edit-role">用户角色</Label>
								<Select
									id="edit-role"
									value={form.role}
									onChange={(e) => set("role")(Number(e.target.value))}
									options={ROLE_OPTIONS}
									disabled={loading}
								/>
							</div>
						</div>
					</Section>

					<Section title="积分与计数">
						<div className="grid gap-4 lg:grid-cols-3">
							<NumberField
								id="edit-credits"
								label="积分"
								value={form.credits}
								onChange={set("credits")}
								disabled={loading}
							/>
							<NumberField
								id="edit-coins"
								label="金币"
								value={form.coins}
								onChange={set("coins")}
								disabled={loading}
							/>
							<NumberField
								id="edit-digestPosts"
								label="精华数"
								value={form.digestPosts}
								onChange={set("digestPosts")}
								disabled={loading}
							/>
							<NumberField
								id="edit-threads"
								label="主题数"
								value={form.threads}
								onChange={set("threads")}
								disabled={loading}
							/>
							<NumberField
								id="edit-posts"
								label="帖子数"
								value={form.posts}
								onChange={set("posts")}
								disabled={loading}
							/>
							<NumberField
								id="edit-olTime"
								label="在线时长"
								value={form.olTime}
								onChange={set("olTime")}
								disabled={loading}
								hint="秒"
							/>
						</div>
					</Section>

					<Section title="用户组装饰">
						<div className="grid gap-4 lg:grid-cols-2">
							<StringField
								id="edit-groupTitle"
								label="用户组标题"
								value={form.groupTitle}
								onChange={set("groupTitle")}
								disabled={loading}
							/>
							<NumberField
								id="edit-groupStars"
								label="用户组星级"
								value={form.groupStars}
								onChange={set("groupStars")}
								disabled={loading}
							/>
							<StringField
								id="edit-groupColor"
								label="用户组颜色"
								value={form.groupColor}
								onChange={set("groupColor")}
								disabled={loading}
								placeholder="#rrggbb"
							/>
							<StringField
								id="edit-customTitle"
								label="自定义头衔"
								value={form.customTitle}
								onChange={set("customTitle")}
								disabled={loading}
							/>
						</div>
						<TextareaField
							id="edit-signature"
							label="个性签名"
							value={form.signature}
							onChange={set("signature")}
							disabled={loading}
							rows={2}
						/>
					</Section>

					<Section title="个人资料">
						<div className="grid gap-4 lg:grid-cols-3">
							<NumberField
								id="edit-gender"
								label="性别"
								value={form.gender}
								onChange={set("gender")}
								disabled={loading}
								hint="0=未设, 1=男, 2=女"
							/>
							<NumberField
								id="edit-birthYear"
								label="出生年"
								value={form.birthYear}
								onChange={set("birthYear")}
								disabled={loading}
							/>
							<div className="grid gap-4 grid-cols-2">
								<NumberField
									id="edit-birthMonth"
									label="月"
									value={form.birthMonth}
									onChange={set("birthMonth")}
									disabled={loading}
								/>
								<NumberField
									id="edit-birthDay"
									label="日"
									value={form.birthDay}
									onChange={set("birthDay")}
									disabled={loading}
								/>
							</div>
							<StringField
								id="edit-resideProvince"
								label="居住省份"
								value={form.resideProvince}
								onChange={set("resideProvince")}
								disabled={loading}
							/>
							<StringField
								id="edit-resideCity"
								label="居住城市"
								value={form.resideCity}
								onChange={set("resideCity")}
								disabled={loading}
							/>
							<StringField
								id="edit-graduateSchool"
								label="毕业院校"
								value={form.graduateSchool}
								onChange={set("graduateSchool")}
								disabled={loading}
							/>
							<StringField
								id="edit-campus"
								label="校区"
								value={form.campus}
								onChange={set("campus")}
								disabled={loading}
							/>
							<StringField
								id="edit-qq"
								label="QQ"
								value={form.qq}
								onChange={set("qq")}
								disabled={loading}
							/>
							<StringField
								id="edit-site"
								label="个人主页"
								value={form.site}
								onChange={set("site")}
								disabled={loading}
							/>
						</div>
						<TextareaField
							id="edit-bio"
							label="个人简介"
							value={form.bio}
							onChange={set("bio")}
							disabled={loading}
						/>
						<TextareaField
							id="edit-interest"
							label="兴趣爱好"
							value={form.interest}
							onChange={set("interest")}
							disabled={loading}
							rows={2}
						/>
					</Section>

					<Section title="时间戳">
						<div className="grid gap-4 lg:grid-cols-3">
							<NumberField
								id="edit-regDate"
								label="注册时间"
								value={form.regDate}
								onChange={set("regDate")}
								disabled={loading}
								hint="unix sec"
							/>
							<NumberField
								id="edit-lastLogin"
								label="最后登录"
								value={form.lastLogin}
								onChange={set("lastLogin")}
								disabled={loading}
								hint="unix sec"
							/>
							<NumberField
								id="edit-lastActivity"
								label="最后活动"
								value={form.lastActivity}
								onChange={set("lastActivity")}
								disabled={loading}
								hint="unix sec"
							/>
						</div>
					</Section>

					{/* IP — single column, break-all so IPv6 (~39 chars) wraps cleanly. */}
					<Section title="IP 信息" muted>
						<div className="grid gap-4 grid-cols-1" data-testid="user-edit-ip-section">
							<div className="grid gap-2 min-w-0">
								<Label htmlFor="edit-regIp">注册 IP</Label>
								<Input
									id="edit-regIp"
									value={form.regIp}
									onChange={(e) => set("regIp")(e.target.value)}
									placeholder="IPv4 or IPv6"
									disabled={loading}
									className={IP_INPUT_CLASSNAME}
								/>
							</div>
							<div className="grid gap-2 min-w-0">
								<Label htmlFor="edit-lastIp">最后登录 IP</Label>
								<Input
									id="edit-lastIp"
									value={form.lastIp}
									onChange={(e) => set("lastIp")(e.target.value)}
									placeholder="IPv4 or IPv6"
									disabled={loading}
									className={IP_INPUT_CLASSNAME}
								/>
							</div>
						</div>
					</Section>

					{/* Tombstone (read-only — owned by purge endpoint) */}
					{user && (user.purgedAt ?? 0) > 0 && (
						<Section title="清除记录" muted>
							<div className="grid gap-4 lg:grid-cols-2 text-sm">
								<div className="grid gap-1 min-w-0">
									<Label className="text-muted-foreground">清除时间</Label>
									<div className="px-3 py-2 rounded-md bg-muted/50 font-mono">{user.purgedAt}</div>
								</div>
								<div className="grid gap-1 min-w-0">
									<Label className="text-muted-foreground">操作管理员 ID</Label>
									<div className="px-3 py-2 rounded-md bg-muted/50 font-mono">
										{user.purgedBy ?? 0}
									</div>
								</div>
							</div>
						</Section>
					)}
				</div>

				{/* Footer */}
				<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
							取消
						</Button>
						<Button onClick={handleSave} disabled={loading} className="gap-2">
							<Save className="h-4 w-4" />
							{loading ? "保存中..." : "保存更改"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
