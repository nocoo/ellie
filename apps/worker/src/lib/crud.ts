// Admin CRUD framework — reusable factory functions for admin endpoints
// All admin entities use EntityConfig to declare their CRUD behavior.
// Admin auth = Key B only (validated at router level). No user identity available.

import { errorResponse } from "../middleware/error";
import type { Env } from "./env";
import { parseIdFromPath } from "./parseId";
import { jsonNoStoreResponse, paginatedNoStoreResponse } from "./response";

// ─── Types ────────────────────────────────────────────────────────

/** Filter definition for admin list endpoints */
export interface FilterDef {
	/**
	 * Query param name. For `range` filters this is the *base* name; the
	 * actual min/max query params default to `${param}Min` / `${param}Max`
	 * unless explicitly overridden by `minParam` / `maxParam`.
	 */
	param: string;
	/** D1 column name */
	column: string;
	/**
	 * Match type.
	 * - `exact` — `column = ?` (raw string or parsed value)
	 * - `like` — `column LIKE %raw%`
	 * - `positive` — boolean-style filter for encoded numeric columns: raw
	 *   `1`/`true` → `column > 0`, raw `0`/`false` → `column = 0`. Used when
	 *   the underlying column is a bitmask/RGB pack (e.g. `threads.highlight`)
	 *   and the UI just wants "set" vs "unset".
	 * - `range` — inclusive numeric range `column >= ?Min AND column <= ?Max`,
	 *   each side independent. Reads two query params (see `minParam`/`maxParam`).
	 *   Defaults to integer parsing; floats via `parse: "float"`. Invalid /
	 *   non-finite values are ignored. `0` is a valid bound.
	 */
	type: "exact" | "like" | "positive" | "range";
	/** Value parser — defaults to string passthrough (or `int` for `range`) */
	parse?: "int" | "boolean" | "float";
	/** Range only: query param for the lower bound (default `${param}Min`). */
	minParam?: string;
	/** Range only: query param for the upper bound (default `${param}Max`). */
	maxParam?: string;
}

/** Field definition for create/update */
export interface FieldDef {
	/** Body field name (camelCase) */
	name: string;
	/** D1 column name (snake_case) */
	column: string;
	/** Required for create? */
	required?: boolean;
	/** Default value for create */
	default?: unknown;
	/** Validation function — return error string or null */
	validate?: (value: unknown) => string | null;
}

/** Hook result — return error Response to abort, or undefined to continue */
type HookResult = Response | undefined;

export interface EntityConfig {
	/** D1 table name */
	table: string;
	/** Singular entity name for error codes (e.g., "FORUM") */
	entityName: string;
	/** Auth level (kept for documentation; enforcement is Key B at router level) */
	auth: "admin" | "moderator";
	/** Column list for SELECT (prevents leaking sensitive data) */
	columns: string;
	/** Mapper function: D1 row → API response object */
	mapper: (row: Record<string, unknown>) => unknown;
	/** Filters for list endpoint */
	filters?: FilterDef[];
	/** Sort order for list (default: "id DESC") */
	listSort?: string;
	/** Allowed client-requested sort orders: param value → SQL ORDER BY clause */
	allowedSorts?: Record<string, string>;
	/** Whether list uses pagination (default: true) */
	listPaginated?: boolean;
	/** Fields for create */
	createFields?: FieldDef[];
	/** Fields for update (partial) */
	updateFields?: FieldDef[];
	/** Whether entity can be deleted */
	canDelete?: boolean;
	/** Whether batch delete is enabled */
	batchDelete?: boolean;
	/** Batch delete limit (default: 100) */
	batchLimit?: number;
	/** 404 error code (default: NOT_FOUND) */
	notFoundCode?: string;

	/**
	 * Wrap the SELECT in a derived table so that WHERE/ORDER BY resolve column
	 * names against SELECT-list aliases rather than physical table columns.
	 *
	 * Enable when `columns` contains correlated subqueries whose aliases
	 * collide with physical column names (e.g. `(SELECT COUNT(*) …) AS threads`
	 * vs the cached `users.threads` column). Without wrapping, SQLite's WHERE
	 * binds to the physical column; with wrapping, the outer WHERE sees only
	 * the aliased output of the inner SELECT.
	 */
	useSubqueryWrapper?: boolean;

	/**
	 * Optional list-only enrichment hook. Runs *after* the page query
	 * (so it sees only the page's rows, never N×filter explosion) and
	 * *before* `mapper`. Use to attach virtual columns assembled from
	 * separate aggregate queries — e.g. per-user message / attachment
	 * counts on the admin user list. Must return rows of the same length
	 * and order as the input.
	 */
	enrichListRows?: (
		rows: Record<string, unknown>[],
		env: Env,
	) => Promise<Record<string, unknown>[]>;

	// ─── Lifecycle hooks (no user identity — admin auth is Key B only) ───
	beforeCreate?: (data: Record<string, unknown>, env: Env, origin?: string) => Promise<HookResult>;
	afterCreate?: (
		id: number,
		data: Record<string, unknown>,
		env: Env,
		origin?: string,
	) => Promise<void>;
	beforeUpdate?: (
		id: number,
		data: Record<string, unknown>,
		existing: Record<string, unknown>,
		env: Env,
		origin?: string,
	) => Promise<HookResult>;
	afterUpdate?: (
		id: number,
		data: Record<string, unknown>,
		existing: Record<string, unknown>,
		env: Env,
		origin?: string,
	) => Promise<void>;
	beforeDelete?: (
		id: number,
		existing: Record<string, unknown>,
		env: Env,
		origin?: string,
	) => Promise<HookResult>;
	afterDelete?: (
		id: number,
		existing: Record<string, unknown>,
		env: Env,
		origin?: string,
	) => Promise<void>;
}

// ─── Internal helpers ─────────────────────────────────────────────

const MAX_PAGE_SIZE = 100;

function getOrigin(request: Request): string | undefined {
	return request.headers.get("Origin") ?? undefined;
}

function parseRangeBound(raw: string, parse: FilterDef["parse"]): number | null {
	const n = parse === "float" ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : null;
}

function applyRangeFilter(f: FilterDef, url: URL, conditions: string[], params: unknown[]): void {
	const minParam = f.minParam ?? `${f.param}Min`;
	const maxParam = f.maxParam ?? `${f.param}Max`;
	const rawMin = url.searchParams.get(minParam);
	const rawMax = url.searchParams.get(maxParam);
	if (rawMin !== null && rawMin !== "") {
		const lo = parseRangeBound(rawMin, f.parse);
		if (lo !== null) {
			conditions.push(`${f.column} >= ?`);
			params.push(lo);
		}
	}
	if (rawMax !== null && rawMax !== "") {
		const hi = parseRangeBound(rawMax, f.parse);
		if (hi !== null) {
			conditions.push(`${f.column} <= ?`);
			params.push(hi);
		}
	}
}

function applyFilter(f: FilterDef, raw: string, conditions: string[], params: unknown[]): void {
	if (f.type === "positive") {
		if (raw === "true" || raw === "1") conditions.push(`${f.column} > 0`);
		else if (raw === "false" || raw === "0") conditions.push(`${f.column} = 0`);
		return;
	}
	if (f.parse === "int") {
		const num = Number.parseInt(raw, 10);
		if (Number.isNaN(num)) return;
		conditions.push(`${f.column} = ?`);
		params.push(num);
	} else if (f.parse === "boolean") {
		if (raw === "true" || raw === "1") conditions.push(`${f.column} = 1`);
		else if (raw === "false" || raw === "0") conditions.push(`${f.column} = 0`);
	} else if (f.type === "like") {
		conditions.push(`${f.column} LIKE ?`);
		params.push(`%${raw}%`);
	} else {
		conditions.push(`${f.column} = ?`);
		params.push(raw);
	}
}

function buildWhereClause(
	filters: FilterDef[] | undefined,
	url: URL,
): { whereClause: string; params: unknown[] } {
	const conditions: string[] = [];
	const params: unknown[] = [];
	if (filters) {
		for (const f of filters) {
			if (f.type === "range") {
				applyRangeFilter(f, url, conditions, params);
				continue;
			}
			const raw = url.searchParams.get(f.param);
			if (raw === null || raw === "") continue;
			applyFilter(f, raw, conditions, params);
		}
	}
	return {
		whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
		params,
	};
}

async function parseJsonBody(
	request: Request,
	origin?: string,
): Promise<Record<string, unknown> | Response> {
	try {
		return (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}
}

function validateAndCollectFields(
	fields: FieldDef[],
	body: Record<string, unknown>,
	mode: "create" | "update",
	origin?: string,
): { data: Record<string, unknown> } | Response {
	const data: Record<string, unknown> = {};
	for (const f of fields) {
		const value = body[f.name];
		if (
			mode === "create" &&
			f.required &&
			(value === undefined || value === null || value === "")
		) {
			return errorResponse("INVALID_BODY", 400, { message: `${f.name} is required` }, origin);
		}
		if (value !== undefined && value !== null) {
			if (f.validate) {
				const err = f.validate(value);
				if (err) return errorResponse("INVALID_BODY", 400, { message: err }, origin);
			}
			data[f.column] = value;
		} else if (mode === "create" && f.default !== undefined) {
			data[f.column] = f.default;
		}
	}
	if (mode === "update" && Object.keys(data).length === 0) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "At least one field must be provided" },
			origin,
		);
	}
	return { data };
}

function fetchRow(env: Env, table: string, columns: string, id: number) {
	return env.DB.prepare(`SELECT ${columns} FROM ${table} WHERE id = ?`).bind(id).first();
}

function fetchRowFull(env: Env, table: string, id: number) {
	return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
}

function parseAndValidateId(
	request: Request,
	entityName: string,
	origin?: string,
): number | Response {
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: `Invalid ${entityName.toLowerCase()} ID` },
			origin,
		);
	}
	return id;
}

// ─── Factory: List ────────────────────────────────────────────────

export function createListHandler(config: EntityConfig) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = getOrigin(request);
		const url = new URL(request.url);
		const { whereClause, params } = buildWhereClause(config.filters, url);
		const defaultSort = config.listSort ?? "id DESC";

		// Allow client-requested sort if declared in allowedSorts
		const sortParam = url.searchParams.get("sort");
		const sort =
			sortParam && config.allowedSorts?.[sortParam] ? config.allowedSorts[sortParam] : defaultSort;

		// When useSubqueryWrapper is set, wrap the inner SELECT in a derived
		// table so that WHERE/ORDER BY resolve column references against the
		// SELECT-list aliases (e.g. correlated subquery outputs) rather than
		// physical table columns. Without this, SQLite binds WHERE names to
		// the base table's physical columns — which may be stale cached values
		// that differ from the live-computed aliases in the SELECT list.
		const fromClause = config.useSubqueryWrapper
			? `(SELECT ${config.columns} FROM ${config.table}) AS _t`
			: config.table;
		const selectExpr = config.useSubqueryWrapper ? "*" : config.columns;

		if (config.listPaginated === false) {
			const result = await env.DB.prepare(
				`SELECT ${selectExpr} FROM ${fromClause} ${whereClause} ORDER BY ${sort}`,
			)
				.bind(...params)
				.all();
			const rows = result.results as Record<string, unknown>[];
			const enriched = config.enrichListRows ? await config.enrichListRows(rows, env) : rows;
			return jsonNoStoreResponse(
				enriched.map((r) => config.mapper(r)),
				origin,
			);
		}

		const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
		const limit = Math.min(
			Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10), 1),
			MAX_PAGE_SIZE,
		);
		if (page < 1 || Number.isNaN(page)) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid page number" }, origin);
		}

		const [countResult, result] = await Promise.all([
			env.DB.prepare(`SELECT COUNT(*) as total FROM ${fromClause} ${whereClause}`)
				.bind(...params)
				.first<{ total: number }>(),
			env.DB.prepare(
				`SELECT ${selectExpr} FROM ${fromClause} ${whereClause} ORDER BY ${sort} LIMIT ? OFFSET ?`,
			)
				.bind(...params, limit, (page - 1) * limit)
				.all(),
		]);

		const rows = result.results as Record<string, unknown>[];
		const enriched = config.enrichListRows ? await config.enrichListRows(rows, env) : rows;

		return paginatedNoStoreResponse(
			enriched.map((r) => config.mapper(r)),
			countResult?.total ?? 0,
			page,
			limit,
			origin,
		);
	};
}

// ─── Factory: GetById ─────────────────────────────────────────────

export function createGetByIdHandler(config: EntityConfig) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = getOrigin(request);
		const id = parseAndValidateId(request, config.entityName, origin);
		if (id instanceof Response) return id;

		const row = await fetchRow(env, config.table, config.columns, id);
		if (!row) return errorResponse(config.notFoundCode ?? "NOT_FOUND", 404, undefined, origin);

		return jsonNoStoreResponse(config.mapper(row as Record<string, unknown>), origin);
	};
}

// ─── Factory: Create ──────────────────────────────────────────────

export function createCreateHandler(config: EntityConfig) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = getOrigin(request);
		const fields = config.createFields;
		if (!fields)
			return errorResponse("INTERNAL_ERROR", 500, { message: "Create not configured" }, origin);

		const bodyResult = await parseJsonBody(request, origin);
		if (bodyResult instanceof Response) return bodyResult;

		const fieldResult = validateAndCollectFields(fields, bodyResult, "create", origin);
		if (fieldResult instanceof Response) return fieldResult;
		const { data } = fieldResult;

		if (config.beforeCreate) {
			const hookResult = await config.beforeCreate(data, env, origin);
			if (hookResult instanceof Response) return hookResult;
		}

		const columns = Object.keys(data);
		const result = await env.DB.prepare(
			`INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
		)
			.bind(...Object.values(data))
			.run();

		const newId = result.meta.last_row_id;
		if (config.afterCreate && newId) await config.afterCreate(newId, data, env, origin);

		const row = await fetchRow(env, config.table, config.columns, newId);
		return jsonNoStoreResponse(
			config.mapper(row as Record<string, unknown>),
			origin,
			undefined,
			201,
		);
	};
}

// ─── Factory: Update ──────────────────────────────────────────────

export function createUpdateHandler(config: EntityConfig) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = getOrigin(request);
		const id = parseAndValidateId(request, config.entityName, origin);
		if (id instanceof Response) return id;
		if (!config.updateFields)
			return errorResponse("INTERNAL_ERROR", 500, { message: "Update not configured" }, origin);

		const bodyResult = await parseJsonBody(request, origin);
		if (bodyResult instanceof Response) return bodyResult;

		const existing = await fetchRowFull(env, config.table, id);
		if (!existing) return errorResponse(config.notFoundCode ?? "NOT_FOUND", 404, undefined, origin);

		const fieldResult = validateAndCollectFields(config.updateFields, bodyResult, "update", origin);
		if (fieldResult instanceof Response) return fieldResult;
		const { data } = fieldResult;

		if (config.beforeUpdate) {
			const hookResult = await config.beforeUpdate(
				id,
				data,
				existing as Record<string, unknown>,
				env,
				origin,
			);
			if (hookResult instanceof Response) return hookResult;
		}

		const setClauses = Object.keys(data).map((col) => `${col} = ?`);
		await env.DB.prepare(`UPDATE ${config.table} SET ${setClauses.join(", ")} WHERE id = ?`)
			.bind(...Object.values(data), id)
			.run();

		if (config.afterUpdate)
			await config.afterUpdate(id, data, existing as Record<string, unknown>, env, origin);

		const row = await fetchRow(env, config.table, config.columns, id);
		return jsonNoStoreResponse(config.mapper(row as Record<string, unknown>), origin);
	};
}

// ─── Factory: Remove ──────────────────────────────────────────────

export function createRemoveHandler(config: EntityConfig) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = getOrigin(request);
		const id = parseAndValidateId(request, config.entityName, origin);
		if (id instanceof Response) return id;
		if (config.canDelete === false) {
			return errorResponse(
				"FORBIDDEN",
				403,
				{ message: "Delete not allowed for this entity" },
				origin,
			);
		}

		const existing = await fetchRowFull(env, config.table, id);
		if (!existing) return errorResponse(config.notFoundCode ?? "NOT_FOUND", 404, undefined, origin);

		if (config.beforeDelete) {
			const hookResult = await config.beforeDelete(
				id,
				existing as Record<string, unknown>,
				env,
				origin,
			);
			if (hookResult instanceof Response) return hookResult;
		}

		await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
		if (config.afterDelete)
			await config.afterDelete(id, existing as Record<string, unknown>, env, origin);

		return jsonNoStoreResponse({ deleted: true, id }, origin);
	};
}

// ─── Factory: Batch Delete ────────────────────────────────────────

export function createBatchDeleteHandler(config: EntityConfig) {
	const maxBatch = config.batchLimit ?? 100;

	return async (request: Request, env: Env): Promise<Response> => {
		const origin = getOrigin(request);
		const bodyResult = await parseJsonBody(request, origin);
		if (bodyResult instanceof Response) return bodyResult;

		const { ids } = bodyResult;
		if (!Array.isArray(ids) || ids.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must be a non-empty array" },
				origin,
			);
		}
		if (ids.length > maxBatch) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${maxBatch} items per batch` },
				origin,
			);
		}

		// Dedupe ids before fan-out: with a parallel pipeline, two concurrent
		// runs against the same id would both observe the row as existing, both
		// DELETE (idempotent), and both invoke `afterDelete` — which for hooks
		// that decrement counts (e.g. admin/thread.batchDelete) would
		// double-decrement. Keep insertion order for stable response shape.
		const seen = new Set<number>();
		const numericIds: number[] = [];
		for (const id of ids) {
			const n = Number(id);
			if (Number.isNaN(n) || seen.has(n)) continue;
			seen.add(n);
			numericIds.push(n);
		}
		if (numericIds.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must contain valid numbers" },
				origin,
			);
		}

		// Each id is independent — fan out the per-row delete pipeline so
		// large batches don't pay N round-trips of latency. Hooks (before/after
		// delete) are still invoked per row.
		const results = await Promise.all(
			numericIds.map(async (id) => {
				const existing = await fetchRowFull(env, config.table, id);
				if (!existing) return 0;

				if (config.beforeDelete) {
					const hookResult = await config.beforeDelete(
						id,
						existing as Record<string, unknown>,
						env,
						origin,
					);
					if (hookResult instanceof Response) return 0;
				}

				await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
				if (config.afterDelete)
					await config.afterDelete(id, existing as Record<string, unknown>, env, origin);
				return 1;
			}),
		);
		const count = results.reduce<number>((sum, n) => sum + n, 0);

		return jsonNoStoreResponse({ deleted: true, count }, origin);
	};
}
