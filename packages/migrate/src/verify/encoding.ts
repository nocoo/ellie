/**
 * Encoding verification — random sampling of posts to detect garbled text.
 *
 * Per docs/03-migration.md: sample 1000 posts, verify Chinese content is readable.
 * Checks for UTF-8 replacement characters and CJK character presence.
 */

import type { Database } from "bun:sqlite";

/** Result of encoding verification. */
export interface EncodingReport {
	sampleSize: number;
	totalPosts: number;
	issuesFound: number;
	samples: EncodingSample[];
	passed: boolean;
	summary: string;
}

/** A single sampled post with encoding analysis. */
export interface EncodingSample {
	id: number;
	contentPreview: string;
	hasReplacementChar: boolean;
	hasCjk: boolean;
	issue?: string;
}

/** CJK Unicode ranges for detecting Chinese/Japanese/Korean characters. */
const CJK_REGEX =
	/[\u4E00-\u9FFF\u3400-\u4DBF\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}]/u;

/** UTF-8 replacement character U+FFFD. */
const REPLACEMENT_CHAR = "\uFFFD";

/**
 * Check a single content string for encoding issues.
 */
export function analyzeEncoding(content: string): { hasReplacementChar: boolean; hasCjk: boolean } {
	return {
		hasReplacementChar: content.includes(REPLACEMENT_CHAR),
		hasCjk: CJK_REGEX.test(content),
	};
}

/**
 * Sample random posts and check for encoding issues.
 *
 * @param db - SQLite database connection
 * @param sampleSize - Number of posts to sample (default: 1000)
 * @returns Encoding verification report
 */
export function verifyEncoding(db: Database, sampleSize = 1000): EncodingReport {
	const totalRow = db.query("SELECT COUNT(*) as cnt FROM posts").get() as { cnt: number };
	const totalPosts = totalRow.cnt;

	// Random sampling using SQLite's random() function
	const rows = db
		.query(
			`SELECT id, content FROM posts
			 WHERE content != ''
			 ORDER BY RANDOM()
			 LIMIT ?`,
		)
		.all(sampleSize) as { id: number; content: string }[];

	const samples: EncodingSample[] = [];
	let issuesFound = 0;

	for (const row of rows) {
		const analysis = analyzeEncoding(row.content);
		const preview = row.content.slice(0, 100);

		let issue: string | undefined;
		if (analysis.hasReplacementChar) {
			issue = "Contains U+FFFD replacement character (possible encoding corruption)";
			issuesFound++;
		}

		samples.push({
			id: row.id,
			contentPreview: preview,
			hasReplacementChar: analysis.hasReplacementChar,
			hasCjk: analysis.hasCjk,
			issue,
		});
	}

	const passed = issuesFound === 0;
	const summary = passed
		? `Encoding OK: ${rows.length} posts sampled, 0 issues found`
		: `Encoding issues: ${issuesFound}/${rows.length} sampled posts have problems`;

	return {
		sampleSize: rows.length,
		totalPosts,
		issuesFound,
		samples: samples.filter((s) => s.issue), // Only keep problematic samples in report
		passed,
		summary,
	};
}
