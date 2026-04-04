// messages/layout.tsx — Auth guard layout for private messages
// Google OAuth users see a notice; credentials users proceed to content.

import { CredentialsOnlyNotice } from "@/components/forum/credentials-only-notice";
import { getSessionProvider } from "@/lib/forum-auth";
import type { ReactNode } from "react";

export default async function MessagesLayout({ children }: { children: ReactNode }) {
	const provider = await getSessionProvider();

	// Unauthenticated users are already redirected by proxy.ts
	// This is a safety check (should not happen in normal flow)
	if (!provider) {
		return null;
	}

	// Google OAuth users cannot use private messages (no Worker JWT)
	if (provider !== "credentials") {
		return <CredentialsOnlyNotice feature="站内信" />;
	}

	// Credentials users proceed to the page
	return <>{children}</>;
}
