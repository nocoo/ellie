// components/forum/user-info-card.tsx — Personal info card for user profile
// Shows non-empty profile fields: gender, birthday, location, etc.

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	formatBirthday,
	formatGender,
	formatLastActivity,
	formatLocation,
	formatOlTime,
} from "@/viewmodels/forum/user-profile";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";

export function UserInfoCard({ user }: { user: UserProfileData["user"] }) {
	const gender = formatGender(user.gender);
	const birthday = formatBirthday(user.birthYear, user.birthMonth, user.birthDay);
	const location = formatLocation(user.resideProvince, user.resideCity);
	const olTime = formatOlTime(user.olTime);
	const lastActive = formatLastActivity(user.lastActivity);

	// Collect all info rows — only show card if at least one field has data
	const infoRows: { label: string; value: string }[] = [];
	if (user.campus) infoRows.push({ label: "校区", value: user.campus });
	if (gender) infoRows.push({ label: "性别", value: gender });
	if (birthday) infoRows.push({ label: "生日", value: birthday });
	if (location) infoRows.push({ label: "居住地", value: location });
	if (user.graduateSchool) infoRows.push({ label: "毕业学校", value: user.graduateSchool });
	if (user.qq) infoRows.push({ label: "QQ", value: user.qq });
	if (user.site) infoRows.push({ label: "个人网站", value: user.site });
	if (olTime) infoRows.push({ label: "在线时间", value: olTime });
	if (lastActive) infoRows.push({ label: "最后活动", value: lastActive });

	if (
		infoRows.length === 0 &&
		!user.bio &&
		!user.interest &&
		!user.groupTitle &&
		!user.customTitle
	) {
		return null;
	}

	return (
		<Card size="sm">
			<CardHeader className="border-b">
				<h2 className="text-sm font-medium text-foreground">个人信息</h2>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{/* Group title + custom title */}
					{(user.groupTitle || user.customTitle) && (
						<div className="flex items-center gap-2 flex-wrap text-sm">
							{user.groupTitle && (
								<Badge
									variant="outline"
									style={
										user.groupColor
											? { borderColor: user.groupColor, color: user.groupColor }
											: undefined
									}
								>
									{user.groupTitle}
									{user.groupStars > 0 && (
										<span className="ml-1 text-forum-accent">
											{"★".repeat(Math.min(user.groupStars, 10))}
										</span>
									)}
								</Badge>
							)}
							{user.customTitle && (
								<span className="text-muted-foreground italic text-xs">{user.customTitle}</span>
							)}
						</div>
					)}

					{/* Info grid */}
					{infoRows.length > 0 && (
						<div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
							{infoRows.map((row) => (
								<div key={row.label} className="flex items-baseline gap-2">
									<span className="text-muted-foreground text-xs shrink-0">{row.label}</span>
									{row.label === "个人网站" ? (
										<a
											href={row.value.startsWith("http") ? row.value : `https://${row.value}`}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:underline truncate text-xs"
										>
											{row.value}
										</a>
									) : (
										<span className="text-foreground truncate text-xs">{row.value}</span>
									)}
								</div>
							))}
						</div>
					)}

					{/* Bio */}
					{user.bio && (
						<div>
							<p className="text-xs text-muted-foreground mb-0.5">个人简介</p>
							<p className="text-sm text-foreground">{user.bio}</p>
						</div>
					)}

					{/* Interest */}
					{user.interest && (
						<div>
							<p className="text-xs text-muted-foreground mb-0.5">兴趣爱好</p>
							<p className="text-sm text-foreground">{user.interest}</p>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
