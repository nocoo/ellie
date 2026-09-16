import {
	CalendarDays,
	CircleDollarSign,
	Gift,
	LockKeyhole,
	Megaphone,
	MessageSquare,
	MessagesSquare,
	Pin,
	Vote,
} from "lucide-react";

const THREAD_ICONS = {
	"folder_lock.gif": [LockKeyhole, "已关闭"],
	"pollsmall.gif": [Vote, "投票"],
	"tradesmall.gif": [CircleDollarSign, "交易"],
	"rewardsmall.gif": [Gift, "悬赏"],
	"activitysmall.gif": [CalendarDays, "活动"],
	"debatesmall.gif": [MessagesSquare, "辩论"],
	"pin_1.gif": [Pin, "版块置顶"],
	"pin_2.gif": [Pin, "全站置顶"],
	"pin_3.gif": [Pin, "分区置顶"],
	"pin_4.gif": [Pin, "置顶"],
	"folder_new.gif": [MessageSquare, "最近有回复"],
	"folder_common.gif": [MessageSquare, "主题"],
} as const;

export function ThreadRowIcon({
	iconSrc,
	isGlobalAnnouncement,
	extraClass = "",
}: {
	iconSrc: string;
	isGlobalAnnouncement: boolean;
	extraClass?: string;
}) {
	const filename = iconSrc.split("/").pop() as keyof typeof THREAD_ICONS;
	const [Icon, label] = isGlobalAnnouncement
		? ([Megaphone, "全站公告"] as const)
		: (THREAD_ICONS[filename] ?? THREAD_ICONS["folder_common.gif"]);
	return (
		<Icon
			role="img"
			aria-label={label}
			className={`size-4 shrink-0 ${isGlobalAnnouncement ? "text-destructive" : "text-primary/70"} ${extraClass}`}
		/>
	);
}
