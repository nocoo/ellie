import { ForumLayoutShell } from "@/components/forum/forum-layout";
import { SessionGuard } from "@/components/forum/session-guard";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";
import { buildGlobalFooterViewModel } from "@/viewmodels/forum/footer";
import { buildHeaderViewModel } from "@/viewmodels/forum/header";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export async function generateMetadata(): Promise<Metadata> {
	const settings = await fetchPublicSettings();
	const siteName = getStr(settings, "general.site.name", "Ellie");
	const subtitle = getStr(settings, "general.site.subtitle", "");

	const suffix = subtitle ? `${siteName} - ${subtitle}` : siteName;

	return {
		title: {
			template: `%s - ${suffix}`,
			default: suffix,
		},
		description: getStr(settings, "general.og.description", ""),
		openGraph: {
			title: getStr(settings, "general.og.title", "") || undefined,
			description: getStr(settings, "general.og.description", "") || undefined,
			siteName: getStr(settings, "general.og.site_name", "") || undefined,
			images: getStr(settings, "general.og.image", "")
				? [getStr(settings, "general.og.image", "")]
				: undefined,
			url: getStr(settings, "general.og.url", "") || undefined,
		},
		twitter: {
			card: getStr(settings, "general.og.twitter_card", "summary") as "summary",
			site: getStr(settings, "general.og.twitter_site", "") || undefined,
		},
	};
}

export default async function ForumLayout({ children }: { children: ReactNode }) {
	const settings = await fetchPublicSettings();

	const headerVm = buildHeaderViewModel(settings);
	const footerVm = buildGlobalFooterViewModel(settings);

	return (
		<ForumLayoutShell headerVm={headerVm} footerVm={footerVm}>
			<SessionGuard />
			{children}
		</ForumLayoutShell>
	);
}
