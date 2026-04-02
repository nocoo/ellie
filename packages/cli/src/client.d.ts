export declare class ApiClient {
	private token;
	setToken(token: string): void;
	request<T>(path: string, options?: RequestInit): Promise<T>;
	getForums(): Promise<unknown>;
	getThreads(forumId: number, limit?: number): Promise<unknown>;
	getThread(threadId: number): Promise<unknown>;
	getPosts(threadId: number, limit?: number): Promise<unknown>;
	getUser(userId: number): Promise<unknown>;
}
