// (forum)/login/page.tsx — Login page
// Ref: 04d §登录页 — username + password + error display

"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canLogin } from "@/viewmodels/forum/auth";
import { BookOpen } from "lucide-react";
import { useState } from "react";

/**
 * Login page.
 *
 * Phase 2: Will call signIn("credentials", { username, password })
 * and handle redirect.
 */
export default function LoginPage() {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setError(null);
		// Phase 2: call signIn()
		// Mock: just show error after delay
		setTimeout(() => {
			setError("Login not yet connected (mock phase)");
			setLoading(false);
		}, 500);
	};

	return (
		<div className="flex min-h-[60vh] items-center justify-center">
			<div className="w-full max-w-sm">
				{/* Logo */}
				<div className="mb-8 flex flex-col items-center">
					<BookOpen className="h-10 w-10 text-primary" />
					<span className="mt-2 text-2xl font-bold">Ellie</span>
				</div>

				{/* Login form */}
				<form onSubmit={handleSubmit} className="space-y-4 rounded-[14px] bg-card p-6">
					<div className="space-y-2">
						<Label htmlFor="username">Username</Label>
						<Input
							id="username"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							disabled={loading}
							autoComplete="username"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							disabled={loading}
							autoComplete="current-password"
						/>
					</div>

					{error && (
						<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{error}
						</div>
					)}

					<Button
						type="submit"
						className="w-full"
						disabled={!canLogin(username, password) || loading}
					>
						{loading ? "Logging in..." : "Login"}
					</Button>

					<p className="text-center text-sm text-muted-foreground">
						No account? Contact an administrator.
					</p>
				</form>
			</div>
		</div>
	);
}
