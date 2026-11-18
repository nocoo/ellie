import type { HomeDigestTopic } from "@ellie/types";
import { Button } from "@nocoo/basalt/components/button";
import Link from "next/link";
import { buildDigestShowcaseItem } from "@/viewmodels/forum/home-showcase";
import { DigestIcon } from "./digest-icon";
import { HomeShowcase } from "./home-showcase";

export function DigestShowcase({ threads }: { threads: HomeDigestTopic[] }) {
	return (
		<HomeShowcase
			title="精华推荐"
			icon={<DigestIcon level={1} />}
			action={
				<Button asChild size="sm" variant="outline" className="gap-1.5">
					<Link href="/digest" prefetch={false}>
						<DigestIcon level={1} />
						精华帖
					</Link>
				</Button>
			}
			emptyText="暂无精华主题，优质内容将在这里展示"
			items={threads.map(buildDigestShowcaseItem)}
		/>
	);
}
