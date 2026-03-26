// API client for Ellie Worker
const WORKER_API_URL = process.env.NEXT_PUBLIC_WORKER_API_URL || "http://localhost:8787";

export class ApiClient {
	async request<T>(path: string, options?: RequestInit): Promise<T> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		const res = await fetch(`${WORKER_API_URL}${path}`, {
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

	// Forums
	async getForums() {
		return this.request("/api/v1/forums");
	}

	async getForum(id: number) {
		return this.request(`/api/v1/forums/${id}`);
	}

	// Threads
	async getThreads(params: { forumId?: number; limit?: number; cursor?: string }) {
		const searchParams = new URLSearchParams();
		if (params.forumId) searchParams.set("forumId", String(params.forumId));
		if (params.limit) searchParams.set("limit", String(params.limit));
		if (params.cursor) searchParams.set("cursor", params.cursor);
		return this.request(`/api/v1/threads?${searchParams}`);
	}

	async getThread(id: number) {
		return this.request(`/api/v1/threads/${id}`);
	}

	// Posts
	async getPosts(params: { threadId: number; limit?: number }) {
		const searchParams = new URLSearchParams();
		searchParams.set("threadId", String(params.threadId));
		if (params.limit) searchParams.set("limit", String(params.limit));
		return this.request(`/api/v1/posts?${searchParams}`);
	}

	async getPost(id: number) {
		return this.request(`/api/v1/posts/${id}`);
	}

	// Users
	async getUser(id: number) {
		return this.request(`/api/v1/users/${id}`);
	}
}

// Singleton instance
export const api = new ApiClient();
