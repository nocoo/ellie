"use client";

// Profile edit dialog for users to update their own profile (View layer)
// Opens as a modal overlay with form fields
// MVVM: This is the View layer. State and logic are in useProfileEdit hook.

import { Save, User as UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAvatarContext, useAvatarUrl } from "@/contexts/avatar-context";
import { CAMPUS_OPTIONS, IDENTITY_OPTIONS } from "@/viewmodels/forum/profile-options";
import { GENDER_OPTIONS, useProfileEdit } from "@/viewmodels/forum/use-profile-edit";
import { AvatarUpload } from "./avatar-upload";
import { DialogErrorBanner } from "./dialog-error-banner";
import { DialogHeroHeader } from "./dialog-hero-header";

// ---------------------------------------------------------------------------
// Section heading — keep all section titles visually identical (small dot + label)
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
	return (
		<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
			<span className="h-1 w-1 rounded-full bg-primary" />
			{children}
		</h3>
	);
}

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
		campus: string;
		bio: string;
		interest: string;
		qq: string;
		site: string;
		signature: string;
	};
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProfileEditDialog({ open, onOpenChange, user }: ProfileEditDialogProps) {
	const router = useRouter();
	const { updateAvatar } = useAvatarContext();
	const avatarUrl = useAvatarUrl(user.id);
	const [avatarUploading, setAvatarUploading] = useState(false);

	// Use ViewModel hook for profile editing
	const { state, actions } = useProfileEdit({
		initialData: user,
		open,
		onSuccess: () => onOpenChange(false),
	});

	// Handle avatar upload completion — update saved avatar URL to propagate to all avatar instances
	const handleAvatarUploadComplete = (newUrl: string) => {
		updateAvatar(user.id, newUrl);
		// Also refresh page data for server-rendered content
		router.refresh();
	};

	// Reset error when dialog closes
	const handleOpenChange = (open: boolean) => {
		if (state.submitting || avatarUploading) return;
		if (!open) {
			actions.clearError();
		}
		onOpenChange(open);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className="max-h-[90dvh] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
				showCloseButton={false}
			>
				{/* Header */}
				<DialogHeroHeader
					icon={<UserIcon className="h-5 w-5 text-primary" />}
					title="编辑个人资料"
					description="完善个人介绍，让同济社区更了解你"
					onClose={() => handleOpenChange(false)}
					closeDisabled={state.submitting || avatarUploading}
				/>

				{/* Error display */}
				{state.error && <DialogErrorBanner message={state.error} />}

				{/* Form */}
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-6">
					{/* Avatar Section */}
					<div className="space-y-4">
						<SectionHeading>头像</SectionHeading>
						<AvatarUpload
							currentUrl={avatarUrl}
							onUploadComplete={handleAvatarUploadComplete}
							onBusyChange={setAvatarUploading}
							disabled={state.submitting}
						/>
					</div>

					{/* Basic Info Section */}
					<div className="space-y-4">
						<SectionHeading>基本信息</SectionHeading>

						<div className="grid gap-4 sm:grid-cols-2">
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
										aria-label="出生年份"
										value={state.form.birthYear || ""}
										onChange={(e) => actions.setField("birthYear", Number(e.target.value) || 0)}
										min={1900}
										max={2100}
										disabled={state.submitting}
									/>
									<Input
										type="number"
										placeholder="月"
										aria-label="出生月份"
										value={state.form.birthMonth || ""}
										onChange={(e) => actions.setField("birthMonth", Number(e.target.value) || 0)}
										min={1}
										max={12}
										disabled={state.submitting}
									/>
									<Input
										type="number"
										placeholder="日"
										aria-label="出生日期"
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
						<SectionHeading>居住地</SectionHeading>

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
						<SectionHeading>教育经历</SectionHeading>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="edit-school">身份类型</Label>
								<Select
									id="edit-school"
									value={state.form.graduateSchool}
									onChange={(e) => actions.setField("graduateSchool", e.target.value)}
									options={IDENTITY_OPTIONS}
									disabled={state.submitting}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-campus">校区</Label>
								<Select
									id="edit-campus"
									value={state.form.campus}
									onChange={(e) => actions.setField("campus", e.target.value)}
									options={CAMPUS_OPTIONS}
									disabled={state.submitting}
								/>
							</div>
						</div>
					</div>

					{/* Contact Section */}
					<div className="space-y-4">
						<SectionHeading>联系方式</SectionHeading>

						<div className="grid gap-4 sm:grid-cols-2">
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
						<SectionHeading>个人简介</SectionHeading>

						<div className="grid gap-4 sm:grid-cols-2">
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
							<div className="grid gap-2 sm:col-span-2">
								<Label htmlFor="edit-signature">个性签名</Label>
								<Textarea
									id="edit-signature"
									value={state.form.signature}
									onChange={(e) => actions.setField("signature", e.target.value)}
									maxLength={1000}
									placeholder="发帖/回帖时显示在你内容下方的一句话"
									disabled={state.submitting}
									rows={2}
									className="resize-none"
								/>
							</div>
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="shrink-0 px-5 py-4 border-t border-border bg-muted/20">
					<div className="flex items-center justify-end gap-2">
						<Button
							variant="ghost"
							onClick={() => handleOpenChange(false)}
							disabled={state.submitting || avatarUploading}
						>
							取消
						</Button>
						<Button
							onClick={actions.handleSave}
							disabled={state.submitting || avatarUploading}
							className="gap-2"
							aria-busy={state.submitting || avatarUploading}
						>
							<Save className="h-4 w-4" />
							{avatarUploading ? "头像上传中…" : state.submitting ? "保存中..." : "保存更改"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
