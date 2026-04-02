import { auth } from "@/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "登录" };

/** Server component — redirect credentials users who already have a session. */
export default async function ForumLoginPage() {
	const session = await auth();
	const provider = session?.user ? (session.user as { provider?: string }).provider : undefined;

	if (session && provider === "credentials") {
		redirect("/");
	}

	return <LoginForm />;
}
