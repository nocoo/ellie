import {
	CalendarDays,
	CircleDollarSign,
	Gift,
	LockKeyhole,
	MessageSquare,
	MessagesSquare,
	Pin,
	Vote,
} from "lucide-react";

import Image from "next/image";

const THREAD_ICONS = {
	"folder_lock.gif": [LockKeyhole, "已关闭"],
	"pollsmall.gif": [Vote, "投票"],
	"tradesmall.gif": [CircleDollarSign, "交易"],
	"rewardsmall.gif": [Gift, "悬赏"],
	"activitysmall.gif": [CalendarDays, "活动"],
	"debatesmall.gif": [MessagesSquare, "辩论"],
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
	const filename = iconSrc.split("/").pop() as string;
	const pin =
		isGlobalAnnouncement || filename === "pin_2.gif"
			? { asset: 3, label: "全局置顶" }
			: filename === "pin_3.gif"
				? { asset: 2, label: "分区置顶" }
				: filename === "pin_1.gif"
					? { asset: 1, label: "板块置顶" }
					: null;
	if (pin) {
		return (
			<Image
				src={`/icons/pin_${pin.asset}.svg`}
				alt={pin.label}
				title={pin.label}
				width={17.6}
				height={17.6}
				unoptimized
				className={`size-[1.1rem] shrink-0 ${extraClass}`}
			/>
		);
	}
	const [Icon, label] =
		THREAD_ICONS[filename as keyof typeof THREAD_ICONS] ?? THREAD_ICONS["folder_common.gif"];
	return (
		<Icon
			role="img"
			aria-label={label}
			className={`size-4 shrink-0 text-primary/70 ${extraClass}`}
		/>
	);
}
