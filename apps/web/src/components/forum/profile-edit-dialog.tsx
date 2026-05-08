"use client";

// Profile edit dialog for users to update their own profile (View layer)
// Opens as a modal overlay with form fields
// MVVM: This is the View layer. State and logic are in useProfileEdit hook.

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
import { Textarea } from "@/components/ui/textarea";
import { useAvatarUrl, useAvatarVersion } from "@/contexts/avatar-context";
import { cn } from "@/lib/utils";
import { GENDER_OPTIONS, useProfileEdit } from "@/viewmodels/forum/use-profile-edit";
import { AlertCircle, Save, User as UserIcon, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { AvatarUpload } from "./avatar-upload";

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
// Component
// ---------------------------------------------------------------------------

export function ProfileEditDialog({ open, onOpenChange, user }: ProfileEditDialogProps) {
	const router = useRouter();
	const { updateVersion } = useAvatarVersion();
	const avatarUrl = useAvatarUrl(user.id);

	// Use ViewModel hook for profile editing
	const { state, actions } = useProfileEdit({
		initialData: user,
		open,
		onSuccess: () => onOpenChange(false),
	});

	// Handle avatar upload completion — update version context to propagate to all avatar instances
	const handleAvatarUploadComplete = (newUrl: string) => {
		// Extract version from URL (e.g., "/api/avatar/123?v=1712678400000")
		const match = newUrl.match(/[?&]v=(\d+)/);
		const version = match ? Number.parseInt(match[1], 10) : Date.now();
		updateVersion(user.id, version);
		// Also refresh page data for server-rendered content
		router.refresh();
	};

	// Reset error when dialog closes
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			actions.clearError();
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
								<DialogDescription className="text-xs mt-0.5">更新你的个人信息</DialogDescription>
							</div>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => handleOpenChange(false)}
							disabled={state.submitting}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className="sr-only">关闭</span>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</DialogHeader>

				{/* Error display */}
				{state.error && (
					<div className="mx-5 mt-4 flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3">
						<AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
						<p className="text-sm text-destructive">{state.error}</p>
					</div>
				)}

				{/* Form */}
				<div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
					{/* Avatar Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							头像
						</h3>
						<AvatarUpload
							currentUrl={avatarUrl}
							onUploadComplete={handleAvatarUploadComplete}
							disabled={state.submitting}
						/>
					</div>

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
									value={state.form.gender}
									onChange={(e) => actions.setField("gender", Number(e.target.value))}
									options={GENDER_OPTIONS}
									disabled={state.submitting}
								/>
							</div>

							<div className="grid gap-2">
								<Label>生日</Label>
								<div className="grid grid-cols-3 gap-2">
									<Input
										type="number"
										placeholder="年"
										value={state.form.birthYear || ""}
										onChange={(e) => actions.setField("birthYear", Number(e.target.value) || 0)}
										min={1900}
										max={2100}
										disabled={state.submitting}
									/>
									<Input
										type="number"
										placeholder="月"
										value={state.form.birthMonth || ""}
										onChange={(e) => actions.setField("birthMonth", Number(e.target.value) || 0)}
										min={1}
										max={12}
										disabled={state.submitting}
									/>
									<Input
										type="number"
										placeholder="日"
										value={state.form.birthDay || ""}
										onChange={(e) => actions.setField("birthDay", Number(e.target.value) || 0)}
										min={1}
										max={31}
										disabled={state.submitting}
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
									value={state.form.resideProvince}
									onChange={(e) => actions.setField("resideProvince", e.target.value)}
									maxLength={50}
									placeholder="如：北京"
									disabled={state.submitting}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-city">城市</Label>
								<Input
									id="edit-city"
									value={state.form.resideCity}
									onChange={(e) => actions.setField("resideCity", e.target.value)}
									maxLength={50}
									placeholder="如：朝阳区"
									disabled={state.submitting}
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
								value={state.form.graduateSchool}
								onChange={(e) => actions.setField("graduateSchool", e.target.value)}
								maxLength={100}
								placeholder="学校名称"
								disabled={state.submitting}
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
									value={state.form.qq}
									onChange={(e) => actions.setField("qq", e.target.value)}
									maxLength={20}
									placeholder="QQ 号码"
									disabled={state.submitting}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-site">个人网站</Label>
								<Input
									id="edit-site"
									value={state.form.site}
									onChange={(e) => actions.setField("site", e.target.value)}
									maxLength={200}
									placeholder="https://..."
									disabled={state.submitting}
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
								<Textarea
									id="edit-bio"
									value={state.form.bio}
									onChange={(e) => actions.setField("bio", e.target.value)}
									maxLength={500}
									placeholder="介绍一下自己..."
									disabled={state.submitting}
									rows={3}
									className="resize-none"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-interest">兴趣爱好</Label>
								<Textarea
									id="edit-interest"
									value={state.form.interest}
									onChange={(e) => actions.setField("interest", e.target.value)}
									maxLength={500}
									placeholder="你喜欢什么..."
									disabled={state.submitting}
									rows={3}
									className="resize-none"
								/>
							</div>
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
					<div className="flex items-center justify-end gap-2">
						<Button
							variant="ghost"
							onClick={() => handleOpenChange(false)}
							disabled={state.submitting}
						>
							取消
						</Button>
						<Button onClick={actions.handleSave} disabled={state.submitting} className="gap-2">
							<Save className="h-4 w-4" />
							{state.submitting ? "保存中..." : "保存更改"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
