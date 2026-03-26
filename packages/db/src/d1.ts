// @ellie/db — D1 client abstraction for local development and migration scripts

export interface D1ClientConfig {
	localDbPath?: string; // Local SQLite file path
	remoteUrl?: string; // Remote D1 HTTP API URL (unused for now)
	accountId?: string;
	apiKey?: string;
}

/**
 * D1 client wrapper for unified local/remote access.
 * Currently used by migration scripts for local SQLite access.
 *
 * NOTE: This package uses `bun:sqlite` and must be run with Bun.
 */
export class D1Client {
	private db: any;

	constructor(config: D1ClientConfig) {
		if (!config.localDbPath) {
			throw new Error("localDbPath is required");
		}
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		const Database = require("bun:sqlite").Database;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
		this.db = new Database(config.localDbPath);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		this.db.exec("PRAGMA journal_mode = WAL;");
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		this.db.exec("PRAGMA synchronous = NORMAL;");
	}

	prepare(sql: string) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		return this.db.prepare(sql);
	}

	close() {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
		this.db.close();
	}

	get exec() {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
		return this.db.exec.bind(this.db);
	}
}
