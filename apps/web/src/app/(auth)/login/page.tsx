import { auth } from "@/auth";
import type { Metadata } from "next";
import AlreadyLoggedIn from "./already-logged-in";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "登录 - 同济网论坛" };

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
