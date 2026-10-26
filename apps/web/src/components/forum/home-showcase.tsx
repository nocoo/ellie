import { HOME_DIGEST_LIMIT } from "@ellie/types";
import { Eye, MessageSquare, MessagesSquare } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HomeShowcaseItemViewModel } from "@/viewmodels/forum/home-showcase";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import { DigestIcon } from "./digest-icon";
import { ForumAvatar } from "./user-avatar";

export function HomeShowcaseItem({ item }: { item: HomeShowcaseItemViewModel }) {
	return (
		<div className="space-y-1 py-2.5" data-testid="home-showcase-item">
			<div className="flex items-center gap-2 leading-5">
				{item.digest > 0 ? (
					<DigestIcon level={item.digest} />
				) : (
					<span className="inline-flex shrink-0 rounded bg-primary/10 px-1 py-0.5 text-primary">
						<MessagesSquare className="size-3" aria-hidden="true" />
					</span>
				)}
				<Link
					href={`/threads/${item.id}`}
					prefetch={false}
					className="min-w-0 flex-1 truncate text-sm leading-5 text-foreground transition-colors hover:text-primary"
				>
					{item.subject}
				</Link>
				<span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
					<span className="inline-flex items-center gap-1" title="回复">
						<MessageSquare className="size-3" aria-hidden="true" />
						{item.replies}
					</span>
					{item.views !== undefined && (
						<span className="inline-flex items-center gap-1" title="查看">
							<Eye className="size-3" aria-hidden="true" />
							{item.views}
						</span>
					)}
				</span>
			</div>
			<div className="flex items-center gap-2 text-xs leading-4 text-muted-foreground">
				<Link
					href={`/forums/${item.forumId}`}
					prefetch={false}
					className="min-w-0 flex-1 truncate transition-colors hover:text-primary"
				>
					{item.forumName}
				</Link>
				{item.userId > 0 ? (
					<Link
						href={`/users/${item.userId}`}
						prefetch={false}
						className="flex min-w-0 max-w-[40%] items-center gap-1 transition-colors hover:text-primary"
					>
						<ForumAvatar
							userId={item.userId}
							userName={item.userName}
							avatarPath={item.avatarPath}
							size="xs"
							className="h-4 w-4 shrink-0"
						/>
						<span className="truncate">{item.userName}</span>
					</Link>
				) : (
					<span className="shrink-0">{item.userName}</span>
				)}
				<span className="shrink-0">{formatRelativeTime(item.at)}</span>
			</div>
		</div>
	);
}

export function HomeShowcase({
	title,
	icon,
	action,
	emptyText,
	items,
}: {
	title: string;
	icon: ReactNode;
	action: ReactNode;
	emptyText: string;
	items: HomeShowcaseItemViewModel[];
}) {
	return (
		<Card size="sm" className="min-w-0">
			<CardHeader className="flex flex-row items-center justify-between min-h-7">
				<div className="flex items-center gap-2">
					{icon}
					<CardTitle className="text-base">{title}</CardTitle>
				</div>
				{action}
			</CardHeader>
			<CardContent>
				<section
					className="h-76 overflow-y-auto overscroll-contain"
					aria-label={title}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: this scroll region needs keyboard access
					tabIndex={0}
				>
					{items.length === 0 ? (
						<p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>
					) : (
						<div className="divide-y divide-border/50">
							{items.slice(0, HOME_DIGEST_LIMIT).map((item) => (
								<HomeShowcaseItem key={item.id} item={item} />
							))}
						</div>
					)}
				</section>
			</CardContent>
		</Card>
	);
}
