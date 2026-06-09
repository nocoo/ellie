// IpLookupInline — Phase G.6.4.
//
// Shared inline panel rendered alongside the three IP fields on the
// admin user-detail page (注册 IP / 上次登录 IP / 当前在线 IP). The
// panel is fully passive on mount: it only fetches when the operator
// clicks "查询", and the button is hidden when no IP is available so
// we never round-trip an empty string.
//
// Layout per reviewer (msg=f1a26a36):
//   - Structured `normalized` summary first (city/region/country + isp).
//   - Raw upstream JSON in a default-collapsed <details> wrapper around
//     `JsonCodeBlock`. We wrap externally because JsonCodeBlock itself
//     has no `defaultCollapsed` prop.
//   - Explicit hint when `rawTruncated === true` (worker capped raw at
//     8KB; see docs/20 §13A.1).
//   - Errors mapped to friendly Chinese via `describeIpLookupError`,
//     which switches on `ApiError.code` (NOT_CONFIGURED / INVALID_IP /
//     TIMEOUT / PARSE / TRANSPORT / UPSTREAM_<status>).

"use client";

import { Button } from "@ellie/ui";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { JsonCodeBlock } from "@/components/admin/json-code-block";
import {
	describeIpLookupError,
	formatIpLookupSummary,
	type IpLookupResult,
	lookupIp,
} from "@/viewmodels/admin/ip-lookup";

export interface IpLookupInlineProps {
	/** IP to query. When falsy/blank the query button is hidden. */
	ip: string | null | undefined;
}

export function IpLookupInline({ ip }: IpLookupInlineProps) {
	const trimmed = (ip ?? "").trim();
	const hasIp = trimmed.length > 0;

	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<IpLookupResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	if (!hasIp) return null;

	const handleQuery = async () => {
		setLoading(true);
		setError(null);
		try {
			const r = await lookupIp(trimmed);
			setResult(r);
		} catch (e) {
			setError(describeIpLookupError(e));
			setResult(null);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="mt-1 space-y-2">
			<div className="flex items-center gap-2">
				<Button type="button" size="sm" variant="outline" onClick={handleQuery} disabled={loading}>
					{loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
					{result ? "重新查询" : "查询"}
				</Button>
				{result?.cached ? <span className="text-xs text-muted-foreground">已命中缓存</span> : null}
			</div>

			{error ? <AdminInlineMessage variant="error" text={error} dense /> : null}

			{result ? (
				<div className="space-y-2 rounded-md border p-3 text-sm">
					<div>{formatIpLookupSummary(result.normalized)}</div>
					<dl className="grid grid-cols-[5rem_1fr] gap-y-1 text-xs text-muted-foreground">
						{result.normalized.countryIso2 ? (
							<>
								<dt>国家代码</dt>
								<dd className="font-mono">{result.normalized.countryIso2}</dd>
							</>
						) : null}
						{result.normalized.asn ? (
							<>
								<dt>ASN</dt>
								<dd className="font-mono">{result.normalized.asn}</dd>
							</>
						) : null}
						{result.normalized.org ? (
							<>
								<dt>组织</dt>
								<dd>{result.normalized.org}</dd>
							</>
						) : null}
					</dl>
					{result.rawTruncated ? (
						<AdminInlineMessage
							variant="info"
							text="原始数据超过 8KB，已截断（仅展示规整化字段）"
							dense
						/>
					) : (
						<details>
							<summary className="cursor-pointer text-xs text-muted-foreground">
								原始上游响应
							</summary>
							<JsonCodeBlock value={result.raw} maxHeightClassName="max-h-80" />
						</details>
					)}
				</div>
			) : null}
		</div>
	);
}
