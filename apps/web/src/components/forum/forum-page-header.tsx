import type { ReactNode } from "react";

export function ForumPageHeader({
	icon,
	title,
	description,
	actions,
	children,
}: {
	icon: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex min-w-0 flex-1 items-start gap-3">
					<div
						className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5"
						aria-hidden="true"
					>
						{icon}
					</div>
					<div className="min-w-0">
						<h1 className="text-xl font-semibold tracking-tight text-foreground break-words sm:text-2xl">
							{title}
						</h1>
						{description && (
							<div className="mt-1 text-sm leading-relaxed text-muted-foreground break-words">
								{description}
							</div>
						)}
					</div>
				</div>
				{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
			</div>
			{children && <div className="mt-4 border-t border-border pt-4">{children}</div>}
		</section>
	);
}
