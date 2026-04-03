"use client";

// Profile hero section with edit button for own profile
// Displays user identity and optional edit functionality
// Includes mod actions for Admin/SuperMod users

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { formatTime } from "@/viewmodels/forum/thread-list";
import { formatUserRole, getUserRoleBadgeVariant } from "@/viewmodels/forum/user-profile";
import { Pencil } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProfileEditDialog } from "./profile-edit-dialog";
import { UserModActions } from "./user-mod-actions";

interface ProfileHeroProps {
	user: {
		id: number;
		username: string;
		role: number;
		regDate: number;
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
			<Card size="sm">
				<CardContent>
					<div className="flex items-center gap-4">
						<Avatar className="h-12 w-12 rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)]">
							<AvatarImage
								src={getAvatarUrl(user.id, "middle")}
								alt={user.username}
								className="rounded-sm"
							/>
							<AvatarFallback className="text-sm rounded-sm bg-muted p-0 overflow-hidden">
								<img
									src={getStaticImageUrl("tavatar.gif")}
									alt=""
									className="h-full w-full object-cover"
								/>
							</AvatarFallback>
						</Avatar>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2 flex-wrap">
								<h1 className="text-base font-semibold text-foreground">{user.username}</h1>
								<Badge variant={getUserRoleBadgeVariant(user.role)}>
									{formatUserRole(user.role)}
								</Badge>
							</div>
							<div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
								<span>UID: {user.id}</span>
								<span>·</span>
								<span>注册于 {formatTime(user.regDate)}</span>
							</div>
						</div>
						<div className="flex items-center gap-2 shrink-0">
							{/* Edit profile button (own profile only) */}
							{isOwnProfile && (
								<Button
									variant="outline"
									size="sm"
									className="gap-1.5"
									onClick={() => setEditOpen(true)}
								>
									<Pencil className="h-3.5 w-3.5" />
									<span className="hidden sm:inline">编辑资料</span>
								</Button>
							)}
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
				</CardContent>
			</Card>

			{isOwnProfile && <ProfileEditDialog open={editOpen} onOpenChange={setEditOpen} user={user} />}
		</>
	);
}
