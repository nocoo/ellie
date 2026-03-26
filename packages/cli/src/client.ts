// API client for Ellie Worker
const API_BASE = process.env.ELLIE_API_URL || "https://ellie.nocoo.cloud";

export class ApiClient {
	private token: string | null = null;

	setToken(token: string) {
		this.token = token;
	}

	async request<T>(path: string, options?: RequestInit): Promise<T> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.token) {
			headers.Authorization = `Bearer ${this.token}`;
		}

		const res = await fetch(`${API_BASE}${path}`, {
			...options,
			headers: {
				...headers,
				...options?.headers,
			},
		});

		if (!res.ok) {
			throw new Error(`API error: ${res.status} ${res.statusText}`);
		}

		return res.json() as Promise<T>;
	}

	async getForums() {
		return this.request("/api/v1/forums");
	}

	async getThreads(forumId: number, limit = 20) {
		const params = new URLSearchParams({
			forumId: String(forumId),
			limit: String(limit),
		});
		return this.request(`/api/v1/threads?${params}`);
	}

	async getThread(threadId: number) {
		return this.request(`/api/v1/threads/${threadId}`);
	}

	async getPosts(threadId: number, limit = 20) {
		const params = new URLSearchParams({
			threadId: String(threadId),
			limit: String(limit),
		});
		return this.request(`/api/v1/posts?${params}`);
	}

	async getUser(userId: number) {
		return this.request(`/api/v1/users/${userId}`);
	}
}
