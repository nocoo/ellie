import { ArrowLeft, Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
	return (
		<section className="mx-auto my-10 max-w-xl rounded-2xl border border-border bg-card px-6 py-12 text-center sm:my-16 sm:px-10">
			<Compass className="mx-auto mb-5 h-10 w-10 text-primary" aria-hidden="true" />
			<p className="mb-2 text-xs font-semibold tracking-widest text-muted-foreground">404</p>
			<h1 className="text-2xl font-semibold tracking-tight">没有找到这个页面</h1>
			<p className="mt-3 text-sm leading-6 text-muted-foreground">
				链接可能已失效，或内容已被移除。回到首页，继续发现社区里的新讨论。
			</p>
			<Link
				href="/"
				className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				<ArrowLeft className="h-4 w-4" />
				返回首页
			</Link>
		</section>
	);
}
