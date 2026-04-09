"use client";

// Profile hero section with edit button for own profile
// Displays user identity and optional edit functionality
// Includes mod actions for Admin/SuperMod users

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatUserRole, getUserRoleBadgeVariant } from "@/viewmodels/forum/user-profile";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import { Pencil, User } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProfileEditDialog } from "./profile-edit-dialog";
import { TrackedUserAvatar } from "./user-avatar";
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
			<Card size="sm" className="bg-gradient-to-br from-orange-500/5 via-background to-rose-500/5">
				<CardContent>
					<div className="flex items-center gap-4">
						<TrackedUserAvatar uid={user.id} username={user.username} size="lg" />
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2 flex-wrap">
								<User className="h-5 w-5 text-orange-500 shrink-0" />
								<h1 className="text-base font-semibold text-foreground">{user.username}</h1>
								<Badge variant={getUserRoleBadgeVariant(user.role)}>
									{formatUserRole(user.role)}
								</Badge>
							</div>
							<div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
								<span>UID: {user.id}</span>
								<span>·</span>
								<span>注册于 {formatRelativeTime(user.regDate)}</span>
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
