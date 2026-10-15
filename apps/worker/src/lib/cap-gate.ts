import { errorResponse } from "../middleware/error";
import { type CapConsumeResult, consumeCapToken } from "./cap";
import type { Env } from "./env";

export function capConsumeError(
	result: Exclude<CapConsumeResult, "ok">,
	origin?: string,
): Response {
	if (result === "unavailable") return errorResponse("SERVICE_UNAVAILABLE", 503, undefined, origin);
	if (result === "required") return errorResponse("CAPTCHA_REQUIRED", 400, undefined, origin);
	return errorResponse("CAPTCHA_INVALID", 403, undefined, origin);
}

export async function requireCapToken(
	env: Env,
	token: unknown,
	origin?: string,
): Promise<Response | null> {
	const result = await consumeCapToken(env, token);
	if (result === "ok") return null;
	return capConsumeError(result, origin);
}
