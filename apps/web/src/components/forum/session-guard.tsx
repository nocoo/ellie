"use client";

/**
 * SessionGuard — auto-logout on expired refresh token.
 *
 * Listens to NextAuth session for `error === "RefreshTokenExpired"`.
 * When detected, calls signOut() to clear the stale session and
 * redirect the user to the login page.
 *
 * Mount in forum layout to cover all forum pages.
 *
 * Ref: docs/04g-user-auth.md §7
 */

import { signOut, useSession } from "next-auth/react";
import { useEffect } from "react";
import { setWriteGateScope } from "@/viewmodels/forum/write-gate";

export function SessionGuard() {
	const { data: session, status } = useSession();
	const scope = session?.user
		? `${session.user.provider}:${session.user.id}:${session.user.role ?? "unknown"}:${session.error ?? "ok"}`
		: status;
	useEffect(() => {
		setWriteGateScope(scope);
	}, [scope]);

	useEffect(() => {
		if (session?.error === "RefreshTokenExpired") {
			signOut({ callbackUrl: "/login" });
		}
	}, [session?.error]);

	return null;
}
