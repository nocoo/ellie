"use client";

// Profile hero section with edit button for own profile
// Displays user identity and optional edit functionality
// Includes mod actions for Admin/SuperMod users

import { Badge } from "@nocoo/basalt/components/badge";
import { Button } from "@nocoo/basalt/components/button";
import { LayerCard } from "@nocoo/basalt/components/layer-card";
import { CalendarDays, Mail, MapPin, Pencil, Settings2 } from "@nocoo/basalt/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { formatUserRole, getUserRoleBadgeProps } from "@/viewmodels/forum/user-profile";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import { ProfileEditDialog } from "./profile-edit-dialog";
import { TrackedUserAvatar } from "./user-avatar";
import { UserModActions } from "./user-mod-actions";
import { UserReportButton } from "./user-report-button";

interface ProfileHeroProps {
	user: {
		id: number;
		username: string;
		avatarPath: string;
		role: number;
		regDate: number;
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

export function ProfileHero({ user }: ProfileHeroProps) {
	const { data: session } = useSession();
	const router = useRouter();
	const [editOpen, setEditOpen] = useState(false);

	// Check if viewing own profile
	const isOwnProfile = session?.user?.id === String(user.id);
	// Viewer's role (from session)
	const viewerRole = session?.user?.role ?? 0;

	return (
		<>
			<LayerCard padding="none" className="rounded-2xl border-t-2 border-t-primary py-5">
				<LayerCard.Body className="px-5">
					<div className="flex flex-wrap items-center gap-4 sm:gap-5">
						<TrackedUserAvatar
							uid={user.id}
							username={user.username}
							avatarPath={user.avatarPath}
							size="lg"
							className="size-16 rounded-xl after:rounded-xl sm:size-20 [&_img]:rounded-xl"
						/>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2 flex-wrap">
								<h1 className="break-words text-xl font-semibold tracking-tight text-basalt-foreground sm:text-2xl">
									{user.username}
								</h1>
								<Badge {...getUserRoleBadgeProps(user.role)}>{formatUserRole(user.role)}</Badge>
							</div>
							<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-basalt-muted-foreground">
								<span className="tabular-nums">UID: {user.id}</span>
								<span className="inline-flex items-center gap-1.5">
									<CalendarDays className="size-3.5" aria-hidden="true" />
									注册于 {formatRelativeTime(user.regDate)}
								</span>
								{user.campus && (
									<span className="inline-flex items-center gap-1.5">
										<MapPin className="size-3.5" aria-hidden="true" />
										{user.campus}
									</span>
								)}
							</div>
						</div>
						<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
							{/* Edit profile button (own profile only) */}
							{isOwnProfile && (
								<Button
									variant="outline"
									size="sm"
									className="gap-1.5"
									onClick={() => setEditOpen(true)}
								>
									<Pencil className="h-3.5 w-3.5" aria-hidden="true" />
									编辑资料
								</Button>
							)}
							{isOwnProfile && (
								<Button asChild variant="ghost" size="sm">
									<Link prefetch={false} href="/me">
										<Settings2 className="size-4" aria-hidden="true" />
										我的账号
									</Link>
								</Button>
							)}
							{session?.user && !isOwnProfile && user.id > 0 && (
								<Button asChild size="sm">
									<Link prefetch={false} href={`/messages?to=${user.id}`}>
										<Mail className="size-4" aria-hidden="true" />
										发站内信
									</Link>
								</Button>
							)}
							{/* Report button (any logged-in non-owner). Worker still guards self-report. */}
							<UserReportButton
								userId={user.id}
								isOwnProfile={isOwnProfile}
								isLoggedIn={Boolean(session?.user)}
							/>
							{/* Mod actions (Admin/SuperMod only, not own profile) */}
							<UserModActions
								userId={user.id}
								username={user.username}
								viewerRole={viewerRole}
								isSelf={isOwnProfile}
								variant="button"
								size="sm"
								onActionComplete={() => router.refresh()}
							/>
						</div>
					</div>
				</LayerCard.Body>
			</LayerCard>

			{isOwnProfile && <ProfileEditDialog open={editOpen} onOpenChange={setEditOpen} user={user} />}
		</>
	);
}
