import { CircleDollarSign, Pin } from "lucide-react";

import Image from "next/image";

const SVG_ICONS = {
	"folder_common.gif": ["folder_common", "普通主题"],
	"folder_new.gif": ["folder_new", "24 小时内发布或有回复"],
	"folder_lock.gif": ["folder_lock", "已锁定"],
	"folder_hot.gif": ["folder_hot", "热门主题：回复超过 3 页"],
	"pollsmall.gif": ["pollsmall", "投票"],
	"rewardsmall.gif": ["rewardsmall", "悬赏"],
	"debatesmall.gif": ["debatesmall", "辩论"],
	"activitysmall.gif": ["group", "活动"],
} as const;

const THREAD_ICONS = {
	"tradesmall.gif": [CircleDollarSign, "交易"],
	"pin_4.gif": [Pin, "置顶"],
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
	const special = THREAD_ICONS[filename as keyof typeof THREAD_ICONS];
	if (!special) {
		const key = filename in SVG_ICONS ? (filename as keyof typeof SVG_ICONS) : "folder_common.gif";
		const [asset, label] = SVG_ICONS[key];
		return (
			<Image
				src={`/icons/${asset}.svg`}
				alt={label}
				title={label}
				width={20}
				height={20}
				unoptimized
				className={`size-5 shrink-0 ${extraClass}`}
			/>
		);
	}
	const [Icon, label] = special;
	return (
		<Icon
			role="img"
			aria-label={label}
			className={`size-4 shrink-0 text-primary/70 ${extraClass}`}
		/>
	);
}
