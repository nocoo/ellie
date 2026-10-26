import type { HomeDigestTopic } from "@ellie/types";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buildDigestShowcaseItem } from "@/viewmodels/forum/home-showcase";
import { DigestIcon } from "./digest-icon";
import { HomeShowcase } from "./home-showcase";

export function DigestShowcase({ threads }: { threads: HomeDigestTopic[] }) {
	return (
		<HomeShowcase
			title="精华推荐"
			icon={<DigestIcon level={1} />}
			action={
				<Button
					size="sm"
					variant="outline"
					className="gap-1.5"
					nativeButton={false}
					render={<Link href="/digest" prefetch={false} />}
				>
					<DigestIcon level={1} />
					精华帖
				</Button>
			}
			emptyText="暂无精华主题，优质内容将在这里展示"
			items={threads.map(buildDigestShowcaseItem)}
		/>
	);
}
