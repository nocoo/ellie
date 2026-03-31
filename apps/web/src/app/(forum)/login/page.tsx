import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

/** Server component — redirect credentials users who already have a session. */
export default async function ForumLoginPage() {
	const session = await auth();
	const provider = session?.user ? (session.user as { provider?: string }).provider : undefined;

	if (session && provider === "credentials") {
		redirect("/");
	}

	return <LoginForm />;
}
