import { auth } from "@/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import RegisterForm from "./register-form";

export const metadata: Metadata = { title: "注册新账号 - 同济网论坛" };

/** Server component — redirect credentials users who already have a session. */
export default async function ForumRegisterPage() {
	const session = await auth();
	const provider = session?.user ? (session.user as { provider?: string }).provider : undefined;

	if (session && provider === "credentials") {
		redirect("/");
	}

	return <RegisterForm />;
}
