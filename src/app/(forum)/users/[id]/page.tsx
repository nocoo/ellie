// (forum)/users/[id]/page.tsx — User profile page
// Ref: 04d §用户主页 — user info + tabs (threads/posts)

import { UserAvatar } from "@/components/user-avatar";
import { createRepositories } from "@/data/index";
import { fetchUserProfile } from "@/viewmodels/forum/user-profile";
import { notFound } from "next/navigation";

interface PageProps {
	params: Promise<{ id: string }>;
}

/**
 * User profile page — server component.
 * Displays user info card. Tab content loaded client-side in Phase 2.
 */
export default async function UserProfilePage({ params }: PageProps) {
	const { id } = await params;
	const userId = Number(id);
	const repos = createRepositories();
	const data = await fetchUserProfile(repos, userId);

	if (!data) notFound();

	const { user, roleLabel, statusLabel } = data;

	return (
		<div className="space-y-4">
			{/* User info card */}
			<div className="rounded-[14px] bg-card p-6">
				<div className="flex items-start gap-4">
					<UserAvatar avatar={user.avatar} username={user.username} size="lg" />
					<div>
						<h1 className="text-2xl font-bold">{user.username}</h1>
						<div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
							<span>Role: {roleLabel}</span>
							<span>Status: {statusLabel}</span>
						</div>
						<div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
							<span>Threads: {user.threads}</span>
							<span>Posts: {user.posts}</span>
							<span>Credits: {user.credits}</span>
						</div>
					</div>
				</div>
			</div>

			{/* Tab content placeholder — Phase 2: client component with tab switching */}
			<div className="rounded-[14px] bg-card p-6">
				<p className="text-muted-foreground">Thread and post history will load here.</p>
			</div>
		</div>
	);
}
