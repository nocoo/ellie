"use client";

// Login tab — wraps the login-attempts panel. Mirrors the audit tab shape;
// kept separate so the login-monitoring module can grow independently.

import { LoginAttemptsPanel } from "@/components/admin/analytics/login-attempts-panel";

export function LoginTab(): React.JSX.Element {
	return (
		<div className="space-y-4 md:space-y-6">
			<LoginAttemptsPanel />
		</div>
	);
}
