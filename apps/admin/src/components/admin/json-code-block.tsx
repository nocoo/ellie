// JsonCodeBlock — minimal JSON / text code preview with light syntax color.
//
// Used by the KV monitor's KeyDetailDialog to display metadata + value
// without pulling in shiki / prism / highlight.js for a single internal
// admin page. Behaviour:
//   - If the input is a string, render it as plain text (NOT JSON.stringify'd
//     — KV string values like a session token shouldn't gain wrapping
//     quotes/escapes when displayed).
//   - Otherwise pretty-print with 2-space indent and tokenize for color:
//     keys, string values, numbers, booleans, null, punctuation. The
//     tokenizer is regex-based but operates on `JSON.stringify` output
//     (always well-formed) and preserves whitespace so indentation stays
//     intact. Key vs value-string distinction is by lookahead: a string
//     followed by optional whitespace then `:` is a key.
//   - The container uses `whitespace-pre` + `overflow-auto` so JSON layers
//     are never broken by mid-line wrapping; horizontal scroll handles
//     long lines. The dialog itself is responsible for capping width via
//     `overflow-hidden` + `max-w-*`.
//
// Token color tokens are pinned by `tests/unit/components/json-code-block.test.ts`.

import { cn } from "@ellie/ui/utils";
import type React from "react";

export interface JsonCodeBlockProps {
	/** Anything JSON-serialisable; strings are rendered as plain text. */
	value: unknown;
	/** Optional max-height utility (e.g. "max-h-80"). Defaults to "max-h-[60vh]". */
	maxHeightClassName?: string;
	className?: string;
}

type TokenKind = "key" | "string" | "number" | "boolean" | "null" | "punct" | "plain";
interface Token {
	kind: TokenKind;
	text: string;
}

// Building blocks `JSON.stringify` produces, in order:
//   - quoted strings (handles escaped quotes via \\.)
//   - numbers (incl. exponent)
//   - true / false / null literals
//   - structural punctuation { } [ ] : ,
// Whitespace falls through as "plain" so indentation is preserved.
const TOKEN_RE = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]/g;

export function tokenizeJson(pretty: string): Token[] {
	const out: Token[] = [];
	let lastIndex = 0;
	let m: RegExpExecArray | null;
	TOKEN_RE.lastIndex = 0;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
	while ((m = TOKEN_RE.exec(pretty)) !== null) {
		if (m.index > lastIndex) {
			out.push({ kind: "plain", text: pretty.slice(lastIndex, m.index) });
		}
		const raw = m[0];
		if (raw.startsWith('"')) {
			const after = pretty.slice(m.index + raw.length);
			const isKey = /^\s*:/.test(after);
			out.push({ kind: isKey ? "key" : "string", text: raw });
		} else if (raw === "true" || raw === "false") {
			out.push({ kind: "boolean", text: raw });
		} else if (raw === "null") {
			out.push({ kind: "null", text: raw });
		} else if (/^[{}[\]:,]$/.test(raw)) {
			out.push({ kind: "punct", text: raw });
		} else {
			out.push({ kind: "number", text: raw });
		}
		lastIndex = m.index + raw.length;
	}
	if (lastIndex < pretty.length) {
		out.push({ kind: "plain", text: pretty.slice(lastIndex) });
	}
	return out;
}

const KIND_CLASS: Record<TokenKind, string> = {
	key: "text-blue-600 dark:text-blue-400",
	string: "text-emerald-600 dark:text-emerald-400",
	number: "text-amber-600 dark:text-amber-400",
	boolean: "text-purple-600 dark:text-purple-400",
	null: "text-purple-600 dark:text-purple-400",
	punct: "text-muted-foreground",
	plain: "",
};

export function JsonCodeBlock({
	value,
	maxHeightClassName,
	className,
}: JsonCodeBlockProps): React.JSX.Element {
	const isString = typeof value === "string";

	// Container: cap width to parent, cap height to viewport, scroll both axes.
	// `whitespace-pre` keeps JSON indentation intact — wrapping would break
	// nested levels visually.
	const baseClass = cn(
		"mt-1 max-w-full overflow-auto rounded bg-muted p-3 font-mono text-xs leading-5",
		"whitespace-pre",
		maxHeightClassName ?? "max-h-[60vh]",
		className,
	);

	if (isString) {
		// Plain string values: render as-is (no JSON quoting), but still
		// allow wrapping for very long single-line strings since there's
		// no JSON layer to preserve.
		return <pre className={cn(baseClass, "whitespace-pre-wrap break-all")}>{value}</pre>;
	}

	const pretty = JSON.stringify(value, null, 2) ?? "";
	const tokens = tokenizeJson(pretty);
	return (
		<pre className={baseClass}>
			{tokens.map((tok, i) => {
				const cls = KIND_CLASS[tok.kind];
				// Token order is stable for a given pretty-printed value, so the
				// array index is a safe React key here (the list never reorders).
				const key = `${i}-${tok.kind}`;
				if (!cls) return <span key={key}>{tok.text}</span>;
				return (
					<span key={key} className={cls}>
						{tok.text}
					</span>
				);
			})}
		</pre>
	);
}
