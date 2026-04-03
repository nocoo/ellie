"use client";

// Profile edit dialog for users to update their own profile
// Opens as a modal overlay with form fields

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ApiError, apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { User } from "@ellie/types";
import { AlertCircle, Save, User as UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: {
		id: number;
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
	};
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENDER_OPTIONS = [
	{ value: 0, label: "未设置" },
	{ value: 1, label: "男" },
	{ value: 2, label: "女" },
];

const ERROR_MESSAGES: Record<string, string> = {
	NOT_AUTHENTICATED: "请先登录",
	INVALID_BODY: "输入数据有误，请检查后重试",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProfileEditDialog({ open, onOpenChange, user }: ProfileEditDialogProps) {
	const router = useRouter();
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Form state
	const [gender, setGender] = useState(0);
	const [birthYear, setBirthYear] = useState(0);
	const [birthMonth, setBirthMonth] = useState(0);
	const [birthDay, setBirthDay] = useState(0);
	const [resideProvince, setResideProvince] = useState("");
	const [resideCity, setResideCity] = useState("");
	const [graduateSchool, setGraduateSchool] = useState("");
	const [bio, setBio] = useState("");
	const [interest, setInterest] = useState("");
	const [qq, setQq] = useState("");
	const [site, setSite] = useState("");

	// Sync form when user changes or dialog opens
	useEffect(() => {
		if (open && user) {
			setGender(user.gender);
			setBirthYear(user.birthYear);
			setBirthMonth(user.birthMonth);
			setBirthDay(user.birthDay);
			setResideProvince(user.resideProvince);
			setResideCity(user.resideCity);
			setGraduateSchool(user.graduateSchool);
			setBio(user.bio);
			setInterest(user.interest);
			setQq(user.qq);
			setSite(user.site);
			setError(null);
		}
	}, [open, user]);

	const handleSave = useCallback(async () => {
		if (submitting) return;

		setSubmitting(true);
		setError(null);

		try {
			await apiClient.patch<User>("/api/v1/users/me", {
				gender,
				birthYear: birthYear || 0,
				birthMonth: birthMonth || 0,
				birthDay: birthDay || 0,
				resideProvince,
				resideCity,
				graduateSchool,
				bio,
				interest,
				qq,
				site,
			});

			onOpenChange(false);
			router.refresh();
		} catch (err) {
			const code = err instanceof ApiError ? err.code : "UNKNOWN";
			const message =
				ERROR_MESSAGES[code] ?? (err instanceof ApiError ? err.message : "保存失败，请稍后重试");
			setError(message);
		} finally {
			setSubmitting(false);
		}
	}, [
		submitting,
		gender,
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
		onOpenChange,
		router,
	]);

	// Reset error when dialog closes
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setError(null);
		}
		onOpenChange(open);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className={cn(
					"w-[calc(100vw-2rem)] sm:w-[520px]",
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
								<DialogTitle className="text-lg">编辑个人资料</DialogTitle>
								<DialogDescription className="text-xs mt-0.5">
									更新你的个人信息
								</DialogDescription>
							</div>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => handleOpenChange(false)}
							disabled={submitting}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className="sr-only">关闭</span>
							<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
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
				{error && (
					<div className="mx-5 mt-4 flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3">
						<AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
						<p className="text-sm text-destructive">{error}</p>
					</div>
				)}

				{/* Form */}
				<div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
					{/* Basic Info Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							基本信息
						</h3>

						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-gender">性别</Label>
								<Select
									id="edit-gender"
									value={gender}
									onChange={(e) => setGender(Number(e.target.value))}
									options={GENDER_OPTIONS}
									disabled={submitting}
								/>
							</div>

							<div className="grid gap-2">
								<Label>生日</Label>
								<div className="grid grid-cols-3 gap-2">
									<Input
										type="number"
										placeholder="年"
										value={birthYear || ""}
										onChange={(e) => setBirthYear(Number(e.target.value) || 0)}
										min={1900}
										max={2100}
										disabled={submitting}
									/>
									<Input
										type="number"
										placeholder="月"
										value={birthMonth || ""}
										onChange={(e) => setBirthMonth(Number(e.target.value) || 0)}
										min={1}
										max={12}
										disabled={submitting}
									/>
									<Input
										type="number"
										placeholder="日"
										value={birthDay || ""}
										onChange={(e) => setBirthDay(Number(e.target.value) || 0)}
										min={1}
										max={31}
										disabled={submitting}
									/>
								</div>
							</div>
						</div>
					</div>

					{/* Location Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							居住地
						</h3>

						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-province">省份</Label>
								<Input
									id="edit-province"
									value={resideProvince}
									onChange={(e) => setResideProvince(e.target.value)}
									maxLength={50}
									placeholder="如：北京"
									disabled={submitting}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-city">城市</Label>
								<Input
									id="edit-city"
									value={resideCity}
									onChange={(e) => setResideCity(e.target.value)}
									maxLength={50}
									placeholder="如：朝阳区"
									disabled={submitting}
								/>
							</div>
						</div>
					</div>

					{/* Education Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							教育经历
						</h3>

						<div className="grid gap-2">
							<Label htmlFor="edit-school">毕业学校</Label>
							<Input
								id="edit-school"
								value={graduateSchool}
								onChange={(e) => setGraduateSchool(e.target.value)}
								maxLength={100}
								placeholder="学校名称"
								disabled={submitting}
							/>
						</div>
					</div>

					{/* Contact Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							联系方式
						</h3>

						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-qq">QQ</Label>
								<Input
									id="edit-qq"
									value={qq}
									onChange={(e) => setQq(e.target.value)}
									maxLength={20}
									placeholder="QQ 号码"
									disabled={submitting}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-site">个人网站</Label>
								<Input
									id="edit-site"
									value={site}
									onChange={(e) => setSite(e.target.value)}
									maxLength={200}
									placeholder="https://..."
									disabled={submitting}
								/>
							</div>
						</div>
					</div>

					{/* Bio Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							个人简介
						</h3>

						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-bio">简介</Label>
								<textarea
									id="edit-bio"
									value={bio}
									onChange={(e) => setBio(e.target.value)}
									maxLength={500}
									placeholder="介绍一下自己..."
									disabled={submitting}
									rows={3}
									className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 resize-none"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-interest">兴趣爱好</Label>
								<textarea
									id="edit-interest"
									value={interest}
									onChange={(e) => setInterest(e.target.value)}
									maxLength={500}
									placeholder="你喜欢什么..."
									disabled={submitting}
									rows={3}
									className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 resize-none"
								/>
							</div>
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
							取消
						</Button>
						<Button onClick={handleSave} disabled={submitting} className="gap-2">
							<Save className="h-4 w-4" />
							{submitting ? "保存中..." : "保存更改"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
