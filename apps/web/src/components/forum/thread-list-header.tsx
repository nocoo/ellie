// components/forum/thread-list-header.tsx — Discuz classic table column header
// Aligns with ThreadItem's 4-column layout

export function ThreadListHeader() {
	return (
		<div className="hidden sm:flex items-center bg-muted/50 border-b border-border text-xs text-muted-foreground font-medium">
			<div className="min-w-0 flex-1 px-3 py-2">主题</div>
			<div className="w-[100px] shrink-0 text-center py-2">作者</div>
			<div className="w-[80px] shrink-0 text-center py-2">回复/查看</div>
			<div className="w-[120px] shrink-0 text-center py-2">最后发表</div>
		</div>
	);
}
