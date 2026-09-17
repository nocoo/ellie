import type { Env } from "./env";

/** Preserve D1 metadata while refusing unconfirmed mutations. */
export async function confirmedRun<T = unknown>(
	statement: D1PreparedStatement,
): Promise<D1Result<T>> {
	const result = await statement.run<T>();
	if (!result.success) throw new Error("D1 write was not confirmed");
	return result;
}

export async function confirmedBatch<T = unknown>(
	env: Pick<Env, "DB">,
	statements: D1PreparedStatement[],
): Promise<D1Result<T>[]> {
	const results = await env.DB.batch<T>(statements);
	if (results.length !== statements.length || results.some((result) => !result.success)) {
		throw new Error("D1 batch writes were not confirmed");
	}
	return results;
}
