import Image from "next/image";

export function DigestIcon({ level, className = "" }: { level: number; className?: string }) {
	if (level <= 0) return null;
	const digest = Math.min(level, 3);
	const label = ["", "一级精华", "二级精华", "三级精华"][digest];
	return (
		<Image
			src={`/icons/digest_${digest}.svg`}
			alt={label}
			title={label}
			width={28}
			height={20}
			unoptimized
			className={`h-5 w-7 shrink-0 ${className}`}
		/>
	);
}
