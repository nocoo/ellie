"use client";

import { ArrowLeft, RefreshCw, Unplug } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ForumError({ retry }: { retry: () => void }) {
	return (
		<section className="mx-auto my-8 max-w-xl rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10">
			<Unplug className="mx-auto mb-5 h-10 w-10 text-primary" aria-hidden="true" />
			<h1 className="text-2xl font-semibold tracking-tight">页面暂时无法加载</h1>
			<p className="mt-3 text-sm leading-6 text-muted-foreground">
				请稍后重试，或返回首页继续浏览。
			</p>
			<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
				<Button onClick={retry}>
					<RefreshCw className="h-4 w-4" />
					重新加载
				</Button>
				<Link
					prefetch={false}
					href="/"
					className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
				>
					<ArrowLeft className="h-4 w-4" />
					返回首页
				</Link>
			</div>
		</section>
	);
}
