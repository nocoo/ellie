import { auth } from "@/auth";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";
import type { Metadata } from "next";
import AlreadyLoggedIn from "./already-logged-in";
import LoginForm from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	return { title: `登录 - ${homeLabel}` };
}

/** Server component — show "已登录" card when session exists, login form otherwise. */
export default async function ForumLoginPage() {
	const session = await auth();
	const provider = session?.user ? (session.user as { provider?: string }).provider : undefined;

	if (session && provider === "credentials") {
		const username = session.user?.name ?? "";
		return <AlreadyLoggedIn username={username} />;
	}

	return <LoginForm />;
}
