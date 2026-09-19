// Admin CRUD framework — reusable factory functions for admin endpoints
// All admin entities use EntityConfig to declare their CRUD behavior.
// Admin auth = Key B only (validated at router level). No user identity available.

import { errorResponse } from "../middleware/error";
import {
	adminCountQuery,
	adminListQuery,
	invalidateAdminEntityCache,
	readAdminEntity,
	registerAdminEntity,
} from "./cache/admin-entity-read";
import { normalizeEmail } from "./email-verify";
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
	 * - `expr` — boolean-style filter with two hand-written WHERE fragments
	 *   (`trueExpr` / `falseExpr`). Used when a single column can't express
	 *   the intent — e.g. "has avatar" = `avatar_path != '' OR has_avatar = 1`
	 *   which spans two columns. Column is ignored for this type; put the
	 *   full parenthesised fragment in trueExpr/falseExpr.
	 */
	type: "exact" | "prefix" | "email" | "username" | "like" | "positive" | "range" | "expr";
	/** Contains search requires one of these indexed scopes or a bounded date range. */
	scopeParams?: string[];
	/** Match the nonempty partial index predicate. */
	nonempty?: boolean;
	/** Value parser — defaults to string passthrough (or `int` for `range`) */
	parse?: "int" | "boolean" | "float";
	/** Range only: query param for the lower bound (default `${param}Min`). */
	minParam?: string;
	/** Range only: query param for the upper bound (default `${param}Max`). */
	maxParam?: string;
	/** Existing time index for bounded recent-date list scans. */
	rangeIndex?: string;
	/**
	 * `expr` only — SQL fragment emitted verbatim when raw is `true`/`1`.
	 * MUST be a self-contained boolean expression (wrap in parens if it
	 * contains OR / AND at the top level). Never parameterised; write only
	 * static SQL here.
	 */
	trueExpr?: string;
	/** `expr` only — SQL fragment emitted verbatim when raw is `false`/`0`. */
	falseExpr?: string;
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
		applyPositiveFilter(f, raw, conditions);
		return;
	}
	if (f.type === "expr") {
		applyExprFilter(f, raw, conditions);
		return;
	}
	if (f.parse === "int") {
		applyExactIntFilter(f, raw, conditions, params);
		return;
	}
	if (f.parse === "boolean") {
		applyBooleanFilter(f, raw, conditions);
		return;
	}
	if (f.type === "prefix") {
		conditions.push(`${f.column} LIKE ? ESCAPE '\\'`);
		params.push(`${raw.replace(/[%_\\]/g, "\\$&")}%`);
		return;
	}
	if (f.type === "email") {
		conditions.push(`${f.column} != '' AND ${f.column} = ?`);
		params.push(normalizeEmail(raw));
		return;
	}
	if (f.type === "username") {
		conditions.push(`${f.column} IN (SELECT id FROM users WHERE username = ? COLLATE NOCASE)`);
		params.push(raw);
		return;
	}
	if (f.nonempty) conditions.push(`${f.column} != ''`);
	if (f.type === "like") {
		conditions.push(`${f.column} LIKE ?`);
		params.push(`%${raw}%`);
		return;
	}
	conditions.push(`${f.column} = ?`);
	params.push(raw);
}

function applyPositiveFilter(f: FilterDef, raw: string, conditions: string[]): void {
	if (raw === "true" || raw === "1") conditions.push(`${f.column} > 0`);
	else if (raw === "false" || raw === "0") conditions.push(`${f.column} = 0`);
}

function applyExprFilter(f: FilterDef, raw: string, conditions: string[]): void {
	// `expr` fragments come from EntityConfig authors (never user input),
	// so we emit them verbatim without parameterisation. Raw values
	// outside {true|1|false|0} are ignored — matches `positive`.
	if ((raw === "true" || raw === "1") && f.trueExpr) conditions.push(f.trueExpr);
	else if ((raw === "false" || raw === "0") && f.falseExpr) conditions.push(f.falseExpr);
}

function applyExactIntFilter(
	f: FilterDef,
	raw: string,
	conditions: string[],
	params: unknown[],
): void {
	const num = Number.parseInt(raw, 10);
	if (Number.isNaN(num)) return;
	conditions.push(`${f.column} = ?`);
	params.push(num);
}

function applyBooleanFilter(f: FilterDef, raw: string, conditions: string[]): void {
	if (raw === "true" || raw === "1") conditions.push(`${f.column} = 1`);
	else if (raw === "false" || raw === "0") conditions.push(`${f.column} = 0`);
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

// ─── Pure administrative read loaders ─────────────────────────────

export interface AdminEntityList {
	items: unknown[];
	total: number;
	page: number;
	limit: number;
	paginated: boolean;
}

function entityListSql(config: EntityConfig, query: string) {
	const url = new URL("https://cache.internal/");
	url.search = query;
	const { whereClause, params } = buildWhereClause(config.filters, url);
	const sortParam = url.searchParams.get("sort");
	const sort =
		sortParam && config.allowedSorts?.[sortParam]
			? config.allowedSorts[sortParam]
			: (config.listSort ?? "id DESC");
	// Narrow date filters must seek by time before sorting by ID. Let the
	// planner choose for broad/history-only filters, where an ID scan can win.
	const indexedRange = config.filters?.find((filter) => {
		if (!filter.rangeIndex || filter.type !== "range") return false;
		const rawMin = url.searchParams.get(filter.minParam ?? `${filter.param}Min`);
		const rawMax = url.searchParams.get(filter.maxParam ?? `${filter.param}Max`);
		const min = rawMin ? parseRangeBound(rawMin, filter.parse) : null;
		const max = rawMax ? parseRangeBound(rawMax, filter.parse) : Math.floor(Date.now() / 1000);
		return min !== null && max !== null && min > 0 && max >= min && max - min <= 90 * 86400;
	});
	const from = config.useSubqueryWrapper
		? `(SELECT ${config.columns} FROM ${config.table}) AS _t`
		: `${config.table}${indexedRange ? ` INDEXED BY ${indexedRange.rangeIndex}` : ""}`;
	const select = config.useSubqueryWrapper ? "*" : config.columns;
	return { url, whereClause, params, from, select, sort };
}

export async function loadEntityCount(
	config: EntityConfig,
	env: Env,
	query: string,
): Promise<number> {
	const { from, whereClause, params } = entityListSql(config, query);
	const row = await env.DB.prepare(`SELECT COUNT(*) as total FROM ${from} ${whereClause}`)
		.bind(...params)
		.first<{ total: number }>();
	if (!row || !Number.isSafeInteger(row.total) || row.total < 0)
		throw new Error("Admin entity count could not be loaded");
	return row.total;
}

export async function loadEntityList(
	config: EntityConfig,
	env: Env,
	query: string,
	ctx?: ExecutionContext,
	freshCount = false,
): Promise<AdminEntityList> {
	const { url, whereClause, params, from, select, sort } = entityListSql(config, query);
	const page = Number(url.searchParams.get("page") ?? 1);
	const limit = Number(url.searchParams.get("limit") ?? 20);
	const paginated = config.listPaginated !== false;
	const [count, result] = await Promise.all([
		paginated
			? !freshCount && registerAdminEntity(config)
				? readAdminEntity<number>(
						env,
						ctx,
						{
							family: "admin:entity:count",
							scope: "admin",
							params: { entity: config.table, query: adminCountQuery(config, url.searchParams) },
						},
						() => loadEntityCount(config, env, query),
					)
				: loadEntityCount(config, env, query)
			: null,
		env.DB.prepare(
			`SELECT ${select} FROM ${from} ${whereClause} ORDER BY ${sort}${paginated ? " LIMIT ? OFFSET ?" : ""}`,
		)
			.bind(...params, ...(paginated ? [limit, (page - 1) * limit] : []))
			.all<Record<string, unknown>>(),
	]);
	if (!result.success) throw new Error("Admin entity list could not be loaded");
	const rows = config.enrichListRows
		? await config.enrichListRows(result.results, env)
		: result.results;
	return {
		items: rows.map((row) => config.mapper(row)),
		total: paginated
			? Math.max(count ?? 0, rows.length ? (page - 1) * limit + rows.length : 0)
			: rows.length,
		page,
		limit,
		paginated,
	};
}

export async function loadEntityDetail(
	config: EntityConfig,
	env: Env,
	id: number,
): Promise<unknown> {
	const row = await fetchRow(env, config.table, config.columns, id);
	return row ? config.mapper(row as Record<string, unknown>) : null;
}

export function createListHandler(config: EntityConfig) {
	const cached = registerAdminEntity(config);
	return async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = getOrigin(request);
		let query: string;
		try {
			query = adminListQuery(config, new URL(request.url).searchParams);
		} catch (error) {
			const scopeRequired = error instanceof Error && error.message === "SEARCH_SCOPE_REQUIRED";
			return errorResponse(
				scopeRequired ? "SEARCH_SCOPE_REQUIRED" : "INVALID_REQUEST",
				400,
				scopeRequired ? undefined : { message: "Invalid page number" },
				origin,
			);
		}
		const descriptor = {
			family: "admin:entity:list",
			params: { entity: config.table, query },
			scope: "admin",
		};
		const loader = () => loadEntityList(config, env, query, ctx);
		const data = cached ? await readAdminEntity(env, ctx, descriptor, loader) : await loader();
		return data.paginated
			? paginatedNoStoreResponse(data.items, data.total, data.page, data.limit, origin)
			: jsonNoStoreResponse(data.items, origin);
	};
}

export function createGetByIdHandler(config: EntityConfig) {
	const cached = registerAdminEntity(config);
	return async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = getOrigin(request);
		const id = parseAndValidateId(request, config.entityName, origin);
		if (id instanceof Response) return id;
		const descriptor = {
			family: "admin:entity:detail",
			params: { entity: config.table, id },
			scope: "admin",
		};
		const loader = () => loadEntityDetail(config, env, id);
		const data = cached ? await readAdminEntity(env, ctx, descriptor, loader) : await loader();
		if (data === null)
			return errorResponse(config.notFoundCode ?? "NOT_FOUND", 404, undefined, origin);
		return jsonNoStoreResponse(data, origin);
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

		if (!result.success) throw new Error("Entity creation was not confirmed");
		const changes = result.meta.changes ?? 0;
		const newId = result.meta.last_row_id;
		if (changes > 0) {
			if (config.afterCreate && newId) await config.afterCreate(newId, data, env, origin);
			await invalidateAdminEntityCache(env, config.table);
		}

		const row = await fetchRow(env, config.table, config.columns, newId);
		return jsonNoStoreResponse(
			config.mapper(row as Record<string, unknown>),
			origin,
			undefined,
			201,
		);
	};
}

async function applyEntityUpdate(
	env: Env,
	config: EntityConfig,
	id: number,
	data: Record<string, unknown>,
	existingRecord: Record<string, unknown>,
	origin?: string,
): Promise<void> {
	const setClauses = Object.keys(data).map((col) => `${col} = ?`);
	const written = await env.DB.prepare(
		`UPDATE ${config.table} SET ${setClauses.join(", ")} WHERE id = ?`,
	)
		.bind(...Object.values(data), id)
		.run();
	if (!written.success) throw new Error("Entity update was not confirmed");

	const changes = written.meta.changes ?? 0;
	if (changes > 0) {
		if (config.afterUpdate) await config.afterUpdate(id, data, existingRecord, env, origin);
		await invalidateAdminEntityCache(env, config.table);
	}
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

		const existingRecord = existing as Record<string, unknown>;
		const hasRealChanges = Object.entries(data).some(([col, val]) => existingRecord[col] !== val);

		if (hasRealChanges) {
			await applyEntityUpdate(env, config, id, data, existingRecord, origin);
		}

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

		const written = await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
		if (!written.success) throw new Error("Entity deletion was not confirmed");
		const changes = written.meta.changes ?? 0;
		if (changes > 0) {
			if (config.afterDelete)
				await config.afterDelete(id, existing as Record<string, unknown>, env, origin);
			await invalidateAdminEntityCache(env, config.table);
		}

		return jsonNoStoreResponse({ deleted: changes > 0, id }, origin);
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

				const written = await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`)
					.bind(id)
					.run();
				if (!written.success) throw new Error("Entity deletion was not confirmed");
				const changes = written.meta.changes ?? 0;
				if (changes > 0) {
					if (config.afterDelete)
						await config.afterDelete(id, existing as Record<string, unknown>, env, origin);
					return 1;
				}
				return 0;
			}),
		);
		const count = results.reduce<number>((sum, n) => sum + n, 0);
		if (count > 0) {
			await invalidateAdminEntityCache(env, config.table);
		}

		return jsonNoStoreResponse({ deleted: true, count }, origin);
	};
}
