// Dove email-relay client (docs/17 §8).
//
// Phase 3 only uses one template (slug configured via `env.DOVE_TEMPLATE_SLUG`,
// e.g. `verify-email`) with a single recipient per call. The dove webhook
// accepts `{ template, to, idempotency_key, variables }`.
//
// IMPORTANT: this module is unaware of the read-only "open recipients" gate
// described in docs/17 §8.1a. That gate is a dove-side change (phase 4a) — until
// it ships, calls here will fail with `recipient_not_found` for arbitrary users.
// Phase 3 wires the endpoints behind the gate so the rest of the flow is testable.

import type { Env } from "./env";

export interface DoveSendOk {
	ok: true;
}

export interface DoveSendErr {
	ok: false;
	/** Best-effort upstream error code (e.g. `recipient_not_found`, `timeout`, `http_502`). */
	code: string;
	/** HTTP status from dove, or 0 for transport-level failures. */
	status: number;
}

export type DoveSendResult = DoveSendOk | DoveSendErr;

export interface DoveSendInput {
	to: string;
	template: string;
	idempotencyKey: string;
	variables: Record<string, string>;
}

/**
 * Send a templated email via dove. Returns a discriminated union — callers
 * MUST branch on `ok` and treat any `false` result as "do not mutate KV".
 *
 * Required env: DOVE_BASE_URL, DOVE_PROJECT_ID, DOVE_WEBHOOK_TOKEN.
 *
 * Timeout: 5s (`AbortSignal.timeout`). Plaintext code is passed through
 * `variables` and is the caller's responsibility to never log.
 */
export async function sendDoveEmail(env: Env, input: DoveSendInput): Promise<DoveSendResult> {
	if (!env.DOVE_BASE_URL || !env.DOVE_PROJECT_ID || !env.DOVE_WEBHOOK_TOKEN) {
		return { ok: false, code: "dove_not_configured", status: 0 };
	}

	const url = `${env.DOVE_BASE_URL.replace(/\/+$/, "")}/api/webhook/${env.DOVE_PROJECT_ID}/send`;

	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.DOVE_WEBHOOK_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				template: input.template,
				to: input.to,
				idempotency_key: input.idempotencyKey,
				variables: input.variables,
			}),
			signal: AbortSignal.timeout(5000),
		});
	} catch (err) {
		const code =
			err instanceof Error && err.name === "TimeoutError" ? "timeout" : "transport_error";
		return { ok: false, code, status: 0 };
	}

	if (res.ok) {
		return { ok: true };
	}

	// Best-effort: surface the upstream error code if dove returns the standard
	// `{ error: { code } }` envelope. Never assume the body parses.
	let upstreamCode = `http_${res.status}`;
	try {
		const body = (await res.json()) as { error?: { code?: string } };
		if (body?.error?.code) upstreamCode = body.error.code;
	} catch {
		/* ignore — keep default code */
	}
	return { ok: false, code: upstreamCode, status: res.status };
}
