// components/forum/messages-page.tsx — Discuz-style 站内消息 page layout
// Two-column layout: notification sidebar (left) + message list (right).
// Layout only — no real data fetching or actions.

"use client";

import { UserAvatar } from "@/components/forum/user-avatar";
import { type BreadcrumbItem, Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { getAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type {
	MessageItem,
	MessagesPageViewModel,
	NotifMenuItem,
} from "@/viewmodels/forum/messages";
import { Bell, FileText, Grid3X3, Mail, Search, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessagesPageProps {
	breadcrumbs: BreadcrumbItem[];
	vm: MessagesPageViewModel;
}

// ---------------------------------------------------------------------------
// Icon resolver for sidebar items
// ---------------------------------------------------------------------------

const SIDEBAR_ICONS: Record<NotifMenuItem["icon"], React.ElementType> = {
	mail: Mail,
	"file-text": FileText,
	users: Users,
	bell: Bell,
	wrench: Wrench,
	grid: Grid3X3,
};

// ---------------------------------------------------------------------------
// Left sidebar: Notification menu
// ---------------------------------------------------------------------------

function NotifSidebar({
	items,
	activeItem,
	onItemChange,
}: {
	items: NotifMenuItem[];
	activeItem: string;
	onItemChange: (v: string) => void;
}) {
	return (
		<aside className="w-[160px] flex-shrink-0">
			<h2 className="text-base font-bold text-foreground mb-3">通知</h2>
			<nav className="flex flex-col gap-0.5">
				{items.map((item) => {
					const Icon = SIDEBAR_ICONS[item.icon];
					const isActive = item.value === activeItem;

					return (
						<button
							key={item.value}
							type="button"
							onClick={() => onItemChange(item.value)}
							className={cn(
								"flex items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors text-left",
								isActive ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground",
							)}
						>
							<Icon className="h-4 w-4 flex-shrink-0" />
							<span>{item.label}</span>
							{item.badge !== undefined && (
								<span
									className={cn(
										"text-xs",
										isActive ? "text-primary font-bold" : "text-muted-foreground",
									)}
								>
									({item.badge})
								</span>
							)}
						</button>
					);
				})}
			</nav>
		</aside>
	);
}

// ---------------------------------------------------------------------------
// Message tabs header (私人消息 | 公共消息 | [发送消息] + 短消息设置)
// ---------------------------------------------------------------------------

function MessageTabsHeader({
	vm,
	activeTab,
	onTabChange,
}: {
	vm: MessagesPageViewModel;
	activeTab: string;
	onTabChange: (v: string) => void;
}) {
	return (
		<div className="flex items-center justify-between border-b border-border pb-0">
			<div className="flex items-end">
				{vm.tabs.map((tab) => {
					if (tab.isAction) {
						return (
							<Button key={tab.value} size="sm" className="ml-2 mb-1 px-4 text-sm">
								{tab.label}
							</Button>
						);
					}

					const isActive = tab.value === activeTab;
					return (
						<button
							key={tab.value}
							type="button"
							onClick={() => onTabChange(tab.value)}
							className={cn(
								"px-4 py-2 text-sm font-medium transition-colors border border-border -mb-px",
								isActive
									? "bg-card text-foreground border-b-card"
									: "bg-muted text-muted-foreground hover:text-foreground border-b-border",
							)}
						>
							{tab.label}
						</button>
					);
				})}
			</div>
			<Link
				href="#"
				className="text-sm text-muted-foreground hover:text-primary transition-colors mb-1"
			>
				短消息设置
			</Link>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Unread banner
// ---------------------------------------------------------------------------

function UnreadBanner({ count }: { count: number }) {
	if (count === 0) return null;

	return (
		<div className="rounded-sm border border-dz-reminder-text/30 bg-dz-reminder-text/5 px-4 py-2.5 mt-3">
			<Link href="#" className="text-sm text-primary hover:underline">
				💡 点击这里查看 <span className="font-bold text-primary">{count}</span> 条未读消息
			</Link>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Single message row
// ---------------------------------------------------------------------------

function MessageRow({ message }: { message: MessageItem }) {
	const isIncoming = message.direction === "incoming";

	return (
		<div className="flex gap-3 border-b border-border py-4 last:border-b-0">
			{/* Checkbox */}
			<div className="flex items-start pt-1">
				<input type="checkbox" className="h-3.5 w-3.5 rounded border-border accent-primary" />
			</div>

			{/* Avatar */}
			<div className="flex-shrink-0">
				<UserAvatar
					src={getAvatarUrl(message.peerUid, "middle")}
					alt={message.peerUsername}
					className="h-[48px] w-[48px] rounded"
				/>
			</div>

			{/* Content */}
			<div className="flex-1 min-w-0">
				{/* Header: "username 对 您 说：" or "您 对 username 说：" */}
				<div className="text-sm">
					{isIncoming ? (
						<>
							<Link
								href={`/users/${message.peerUid}`}
								className="font-bold text-foreground hover:text-primary"
							>
								{message.peerUsername}
							</Link>
							<span className="text-muted-foreground"> 对 </span>
							<span className="font-bold text-foreground">您</span>
							<span className="text-muted-foreground"> 说：</span>
						</>
					) : (
						<>
							<span className="font-bold text-foreground">您</span>
							<span className="text-muted-foreground"> 对 </span>
							<Link
								href={`/users/${message.peerUid}`}
								className="font-bold text-foreground hover:text-primary"
							>
								{message.peerUsername}
							</Link>
							<span className="text-muted-foreground"> 说：</span>
						</>
					)}
				</div>

				{/* Preview */}
				<p className="mt-1 text-sm text-foreground leading-relaxed line-clamp-2">
					{message.preview}
				</p>

				{/* Footer: date + stats + reply */}
				<div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
					<span>{message.date}</span>
					<div className="flex items-center gap-0">
						<span>共{message.totalMessages}条</span>
						<span className="mx-1.5">
							<Search className="inline h-3 w-3" />
						</span>
						<span className="text-border mx-1">|</span>
						<Link href="#" className="text-primary hover:underline">
							回复
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------

function MessageList({ messages }: { messages: MessageItem[] }) {
	if (messages.length === 0) {
		return <div className="py-12 text-center text-sm text-muted-foreground">暂无消息</div>;
	}

	return (
		<div className="mt-2">
			{messages.map((msg) => (
				<MessageRow key={msg.id} message={msg} />
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main export: MessagesPage
// ---------------------------------------------------------------------------

export function MessagesPage({ breadcrumbs, vm }: MessagesPageProps) {
	const [activeSidebar, setActiveSidebar] = useState("messages");
	const [activeTab, setActiveTab] = useState("private");

	return (
		<div className="space-y-2">
			{/* Breadcrumbs */}
			{breadcrumbs.length > 1 && (
				<div className="py-2">
					<Breadcrumbs items={breadcrumbs} />
				</div>
			)}

			{/* Two-column layout */}
			<div className="flex gap-4">
				{/* Left sidebar */}
				<NotifSidebar
					items={vm.sidebarItems}
					activeItem={activeSidebar}
					onItemChange={setActiveSidebar}
				/>

				{/* Right content area */}
				<div className="flex-1 min-w-0">
					{/* Tabs header */}
					<MessageTabsHeader vm={vm} activeTab={activeTab} onTabChange={setActiveTab} />

					{/* Unread banner */}
					<UnreadBanner count={vm.unreadCount} />

					{/* Message list */}
					<MessageList messages={vm.messages} />
				</div>
			</div>
		</div>
	);
}
