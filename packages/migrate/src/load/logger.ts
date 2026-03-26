/**
 * Migration logger — writes structured failure logs to files.
 *
 * Per docs/03-migration.md error handling section:
 * - migration.log: orphan records (skipped posts/attachments with missing FK refs)
 * - bbcode_failures.log: posts where BBCode conversion failed
 * - encoding_failures.log: posts where encoding could not be repaired
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface MigrationLoggerOptions {
	/** Directory for log files. */
	outputDir: string;
}

export class MigrationLogger {
	private readonly dir: string;
	private readonly counts = {
		orphans: 0,
		bbcodeFailures: 0,
		encodingFailures: 0,
	};

	constructor(options: MigrationLoggerOptions) {
		this.dir = options.outputDir;
	}

	/** Initialize log files with headers. */
	init(): void {
		writeFileSync(
			this.path("migration.log"),
			"# Migration orphan log\n# type\tid\tref_id\treason\n",
		);
		writeFileSync(this.path("bbcode_failures.log"), "# BBCode failure log\n# pid\terror\n");
		writeFileSync(this.path("encoding_failures.log"), "# Encoding failure log\n# pid\tissue\n");
	}

	/** Log an orphan record (post/attachment with missing FK reference). */
	logOrphan(type: string, id: number, refId: number, reason: string): void {
		this.counts.orphans++;
		appendFileSync(this.path("migration.log"), `${type}\t${id}\t${refId}\t${reason}\n`);
	}

	/** Log a BBCode conversion failure. */
	logBbcodeFailure(pid: number, error: string): void {
		this.counts.bbcodeFailures++;
		appendFileSync(this.path("bbcode_failures.log"), `${pid}\t${error}\n`);
	}

	/** Log an encoding issue. */
	logEncodingFailure(pid: number, issue: string): void {
		this.counts.encodingFailures++;
		appendFileSync(this.path("encoding_failures.log"), `${pid}\t${issue}\n`);
	}

	/** Get summary counts. */
	getCounts(): { orphans: number; bbcodeFailures: number; encodingFailures: number } {
		return { ...this.counts };
	}

	private path(filename: string): string {
		return join(this.dir, filename);
	}
}
