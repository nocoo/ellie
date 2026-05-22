import { auth } from "@/auth";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import RegisterForm from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
	try {
		const settings = await fetchPublicSettings();
		const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
		return { title: `注册新账号 - ${homeLabel}` };
	} catch {
		return { title: "注册新账号 - 同济网论坛" };
	}
}

/** Server component — redirect credentials users who already have a session. */
export default async function ForumRegisterPage() {
	const session = await auth();
	const provider = session?.user ? (session.user as { provider?: string }).provider : undefined;

	if (session && provider === "credentials") {
		redirect("/");
	}

	return <RegisterForm />;
}
