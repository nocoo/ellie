"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Button,
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	LayerCard,
} from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import {
	BookUser,
	ChartNoAxesCombined,
	Clock3,
	Globe,
	Palette,
	Save,
	ShieldCheck,
	User as UserIcon,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { twMerge as cn } from "tailwind-merge";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
import type { User, UserUpdate } from "@/viewmodels/admin/users";
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
				{props.hint && <span className="text-xs text-basalt-muted-foreground">{props.hint}</span>}
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
			<InputArea
				id={props.id}
				value={props.value}
				onChange={(e) => props.onChange(e.target.value)}
				disabled={props.disabled}
				rows={props.rows ?? 3}
			/>
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
		if (open && user) dispatch({ type: "reset", user });
	}, [open, user]);

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
				? "text-basalt-primary"
				: form.status === -1
					? "text-basalt-destructive"
					: "text-basalt-muted-foreground",
		[form.status],
	);

	return (
		<Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
			<AdminDialogContent
				className={cn(
					// Wide enough for IPv6 single-column + two-column form grid on lg.
					"w-[calc(100vw-2rem)] sm:w-[640px] lg:w-[860px] sm:max-w-[860px]",
					"max-h-[85vh] overflow-hidden flex flex-col gap-0",
					"rounded-xl p-0",
				)}
				closeControl={false}
			>
				{/* Header */}
				<DialogHeader className="shrink-0 px-5 pt-5 pb-4 border-b border-basalt-border/50">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-basalt-primary/10">
								<UserIcon className="h-5 w-5 text-basalt-primary" />
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
							size="icon"
							onClick={() => onOpenChange(false)}
							disabled={loading}
							className="text-basalt-muted-foreground hover:text-basalt-foreground"
						>
							<span className="sr-only">关闭</span>
							<X aria-hidden="true" className="h-4 w-4" />
						</Button>
					</div>
				</DialogHeader>

				<nav
					aria-label="用户资料分区"
					className="flex shrink-0 flex-wrap gap-1 border-b border-basalt-border/50 px-4 py-2"
				>
					{[
						{ id: "identity", label: "基本信息", icon: UserIcon },
						{ id: "permissions", label: "权限", icon: ShieldCheck },
						{ id: "counters", label: "积分计数", icon: ChartNoAxesCombined },
						{ id: "decoration", label: "用户组", icon: Palette },
						{ id: "profile", label: "个人资料", icon: BookUser },
						{ id: "timestamps", label: "时间", icon: Clock3 },
						{ id: "network", label: "IP 信息", icon: Globe },
					].map(({ id, label, icon: Icon }) => (
						<Button
							key={id}
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 gap-1.5 px-2 text-xs"
							aria-controls={`user-edit-${id}`}
							onClick={() =>
								document.getElementById(`user-edit-${id}`)?.scrollIntoView({ block: "start" })
							}
						>
							<Icon aria-hidden="true" className="h-3.5 w-3.5" />
							{label}
						</Button>
					))}
				</nav>

				{/* Error display */}
				{error && <AdminInlineMessage variant="error" text={error} className="mx-5 mt-4" />}

				{/* Form */}
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-6">
					<SectionRule id="user-edit-identity" title="基本信息" className="scroll-mt-4">
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
								label="标准化邮箱"
								value={form.emailNormalized}
								onChange={set("emailNormalized")}
								disabled={loading}
								placeholder="去除首尾空格并转为小写，非空时须唯一"
							/>
							<NumberField
								id="edit-emailVerifiedAt"
								label="邮箱验证时间"
								value={form.emailVerifiedAt}
								onChange={set("emailVerifiedAt")}
								disabled={loading}
								hint="Unix 秒, 0=未验证"
							/>
							<NumberField
								id="edit-emailChangedAt"
								label="邮箱最近修改"
								value={form.emailChangedAt}
								onChange={set("emailChangedAt")}
								disabled={loading}
								hint="Unix 秒"
							/>
							<div className="grid gap-2 min-w-0">
								<Label htmlFor="edit-avatar">头像链接</Label>
								<div className="flex items-center gap-3 min-w-0">
									{form.avatar && (
										<Avatar className="h-10 w-10 shrink-0">
											<AvatarImage src={form.avatar} alt="头像预览" />
											<AvatarFallback>
												<UserIcon aria-hidden="true" />
											</AvatarFallback>
										</Avatar>
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
					</SectionRule>

					<SectionRule id="user-edit-permissions" title="权限设置" className="scroll-mt-4">
						<div className="grid gap-4 lg:grid-cols-2">
							<div className="grid gap-2 min-w-0">
								<Label htmlFor="edit-status" className="flex items-center justify-between">
									<span>账号状态</span>
									<span className={cn("text-xs", statusColor)}>
										{STATUS_OPTIONS.find((o) => o.value === form.status)?.label}
									</span>
								</Label>
								<Select
									disabled={loading}
									value={String(form.status)}
									onValueChange={(value) => set("status")(Number(value))}
								>
									<SelectTrigger id="edit-status">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{STATUS_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={String(option.value)}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2 min-w-0">
								<Label htmlFor="edit-role">用户角色</Label>
								<Select
									disabled={loading}
									value={String(form.role)}
									onValueChange={(value) => set("role")(Number(value))}
								>
									<SelectTrigger id="edit-role">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{ROLE_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={String(option.value)}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					</SectionRule>

					<SectionRule id="user-edit-counters" title="积分与计数" className="scroll-mt-4">
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
						</div>
					</SectionRule>

					<SectionRule id="user-edit-decoration" title="用户组装饰" className="scroll-mt-4">
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
					</SectionRule>

					<SectionRule id="user-edit-profile" title="个人资料" className="scroll-mt-4">
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
					</SectionRule>

					<SectionRule id="user-edit-timestamps" title="时间戳" className="scroll-mt-4">
						<div className="grid gap-4 lg:grid-cols-3">
							<NumberField
								id="edit-regDate"
								label="注册时间"
								value={form.regDate}
								onChange={set("regDate")}
								disabled={loading}
								hint="Unix 秒"
							/>
							<NumberField
								id="edit-lastLogin"
								label="最后登录"
								value={form.lastLogin}
								onChange={set("lastLogin")}
								disabled={loading}
								hint="Unix 秒"
							/>
							<NumberField
								id="edit-lastActivity"
								label="最后活动"
								value={form.lastActivity}
								onChange={set("lastActivity")}
								disabled={loading}
								hint="Unix 秒"
							/>
						</div>
					</SectionRule>

					{/* IP — single column, break-all so IPv6 (~39 chars) wraps cleanly. */}
					<SectionRule
						id="user-edit-network"
						title="IP 信息"
						className="scroll-mt-4 text-basalt-muted-foreground"
					>
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
					</SectionRule>

					{/* Tombstone (read-only — owned by purge endpoint) */}
					{user && (user.purgedAt ?? 0) > 0 && (
						<SectionRule title="清除记录" className="text-basalt-muted-foreground">
							<div className="grid gap-4 lg:grid-cols-2 text-sm">
								<div className="grid gap-1 min-w-0">
									<Label className="text-basalt-muted-foreground">清除时间</Label>
									<LayerCard padding="none" className="px-3 py-2 font-mono">
										{user.purgedAt}
									</LayerCard>
								</div>
								<div className="grid gap-1 min-w-0">
									<Label className="text-basalt-muted-foreground">操作管理员 ID</Label>
									<LayerCard padding="none" className="px-3 py-2 font-mono">
										{user.purgedBy ?? 0}
									</LayerCard>
								</div>
							</div>
						</SectionRule>
					)}
				</div>

				{/* Footer */}
				<div className="shrink-0 px-5 py-3 border-t border-basalt-border/50">
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
			</AdminDialogContent>
		</Dialog>
	);
}
