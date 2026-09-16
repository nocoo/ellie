// IpLookupInline — Phase G.6.4.
//
// Shared inline panel rendered alongside the three IP fields on the
// admin user-detail page (注册 IP / 上次登录 IP / 当前在线 IP). The
// panel is fully passive on mount: it only fetches when the operator
// clicks "查询", and the button is hidden when no IP is available so
// we never round-trip an empty string.
//
"use client";

import {
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	DescriptionList,
	LayerCard,
} from "@nocoo/basalt";
import { Loader } from "@nocoo/basalt/components/loader";
import { ChevronRight } from "lucide-react";
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
					{loading ? <Loader className="mr-1 h-3 w-3" /> : null}
					{result ? "重新查询" : "查询"}
				</Button>
				{result?.cached ? (
					<span className="text-xs text-basalt-muted-foreground">已命中缓存</span>
				) : null}
			</div>

			{error ? <AdminInlineMessage variant="error" text={error} dense /> : null}

			{result ? (
				<LayerCard padding="sm" outlined className="space-y-2 text-sm">
					<div>{formatIpLookupSummary(result.normalized)}</div>
					<DescriptionList columns={1}>
						{result.normalized.countryIso2 ? (
							<DescriptionList.Item term="国家代码">
								<div className="font-mono">{result.normalized.countryIso2}</div>
							</DescriptionList.Item>
						) : null}
						{result.normalized.asn ? (
							<DescriptionList.Item term="ASN">
								<div className="font-mono">{result.normalized.asn}</div>
							</DescriptionList.Item>
						) : null}
						{result.normalized.org ? (
							<DescriptionList.Item term="组织">{result.normalized.org}</DescriptionList.Item>
						) : null}
					</DescriptionList>
					{result.rawTruncated ? (
						<AdminInlineMessage
							variant="info"
							text="原始数据超过 8KB，已截断（仅展示规整化字段）"
							dense
						/>
					) : (
						<Collapsible>
							<CollapsibleTrigger asChild>
								<Button variant="ghost" size="sm" className="group h-auto p-0 text-xs">
									<ChevronRight className="h-3 w-3 group-data-[state=open]:rotate-90" />
									原始上游响应
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent unstyled>
								<JsonCodeBlock value={result.raw} maxHeightClassName="max-h-80" />
							</CollapsibleContent>
						</Collapsible>
					)}
				</LayerCard>
			) : null}
		</div>
	);
}
