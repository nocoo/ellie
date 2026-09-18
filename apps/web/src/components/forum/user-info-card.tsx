// components/forum/user-info-card.tsx — Personal info card for user profile
// Shows non-empty profile fields: gender, birthday, location, etc.

import { Star, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	formatBirthday,
	formatCheckinDays,
	formatCheckinLevel,
	formatGender,
	formatLastActivity,
	formatLocation,
} from "@/viewmodels/forum/user-profile";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";

export function UserInfoCard({ user }: { user: UserProfileData["user"] }) {
	const gender = formatGender(user.gender);
	const birthday = formatBirthday(user.birthYear, user.birthMonth, user.birthDay);
	const location = formatLocation(user.resideProvince, user.resideCity);
	const lastActive = formatLastActivity(user.lastActivity);
	const checkinLevel = formatCheckinLevel(user.checkin);
	const checkinDays = formatCheckinDays(user.checkin?.totalDays);

	// Collect all info rows — only show card if at least one field has data
	const infoRows: { label: string; value: string }[] = [];
	if (checkinLevel) infoRows.push({ label: "签到等级", value: checkinLevel });
	if (checkinDays) infoRows.push({ label: "签到天数", value: checkinDays });
	if (user.campus) infoRows.push({ label: "校区", value: user.campus });
	if (gender) infoRows.push({ label: "性别", value: gender });
	if (birthday) infoRows.push({ label: "生日", value: birthday });
	if (location) infoRows.push({ label: "居住地", value: location });
	if (user.graduateSchool) infoRows.push({ label: "身份类型", value: user.graduateSchool });
	if (user.qq) infoRows.push({ label: "QQ", value: user.qq });
	if (user.site) infoRows.push({ label: "个人网站", value: user.site });
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
		<Card className="rounded-2xl">
			<CardHeader className="border-b">
				<h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
					<UserRound className="size-4 text-primary" aria-hidden="true" />
					个人信息
				</h2>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
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
										<span className="ml-1 inline-flex items-center gap-1 text-forum-accent">
											<Star className="size-3 fill-current" aria-hidden="true" />
											{user.groupStars}
										</span>
									)}
								</Badge>
							)}
							{user.customTitle && (
								<span
									className="text-muted-foreground italic text-sm"
									data-testid="user-info-custom-title"
								>
									{user.customTitle}
								</span>
							)}
						</div>
					)}

					{/* Info grid */}
					{infoRows.length > 0 && (
						<dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
							{infoRows.map((row) => (
								<div key={row.label} className="flex min-w-0 items-baseline gap-3">
									<dt className="w-16 text-muted-foreground text-xs shrink-0">{row.label}</dt>
									<dd className="min-w-0 flex-1">
										{row.label === "个人网站" ? (
											<a
												href={row.value.startsWith("http") ? row.value : `https://${row.value}`}
												target="_blank"
												rel="noopener noreferrer"
												className="block text-primary hover:underline break-all text-sm"
												data-testid="user-info-value"
											>
												{row.value}
											</a>
										) : (
											<span
												className="text-foreground break-words text-sm"
												data-testid="user-info-value"
											>
												{row.value}
											</span>
										)}
									</dd>
								</div>
							))}
						</dl>
					)}

					{/* Bio */}
					{user.bio && (
						<div>
							<p className="text-xs text-muted-foreground mb-0.5">个人简介</p>
							<p className="text-sm leading-relaxed text-foreground break-words whitespace-pre-line">
								{user.bio}
							</p>
						</div>
					)}

					{/* Interest */}
					{user.interest && (
						<div>
							<p className="text-xs text-muted-foreground mb-0.5">兴趣爱好</p>
							<p className="text-sm leading-relaxed text-foreground break-words whitespace-pre-line">
								{user.interest}
							</p>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
