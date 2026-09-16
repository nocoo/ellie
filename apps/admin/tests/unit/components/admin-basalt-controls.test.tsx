// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable } from "@/components/admin/admin-data-table";

afterEach(cleanup);

it("requires the exact confirmation text and locks dismissal during a mutation", () => {
	const onConfirm = vi.fn();
	const onOpenChange = vi.fn();
	const props = {
		open: true,
		title: "删除用户",
		description: "永久删除用户资料",
		requireInput: "删除用户 42",
		onConfirm,
		onOpenChange,
	};
	const { rerender } = render(<AdminConfirmDialog {...props} />);
	const confirm = screen.getByRole("button", { name: "确认" }) as HTMLButtonElement;
	const input = screen.getByRole("textbox", { name: "确认文本" });
	fireEvent.change(input, { target: { value: "删除用户" } });
	expect(confirm.disabled).toBe(true);
	fireEvent.click(confirm);
	expect(onConfirm).not.toHaveBeenCalled();
	fireEvent.change(input, { target: { value: "删除用户 42" } });
	expect(confirm.disabled).toBe(false);
	fireEvent.click(confirm);
	expect(onConfirm).toHaveBeenCalledTimes(1);

	rerender(<AdminConfirmDialog {...props} loading />);
	fireEvent.keyDown(document, { key: "Escape" });
	fireEvent.click(screen.getByRole("button", { name: "关闭弹窗" }));
	expect(onOpenChange).not.toHaveBeenCalled();
	expect((screen.getByRole("button", { name: "处理中..." }) as HTMLButtonElement).disabled).toBe(
		true,
	);
});

it("keeps row selection and the mixed all-selection state in sync", () => {
	function Table() {
		const [selectedIds, setSelectedIds] = useState(new Set<string | number>());
		return (
			<AdminDataTable
				columns={[{ key: "id", header: "用户", cell: (row) => row.id }]}
				data={[{ id: 1 }, { id: 2 }]}
				getRowId={(row) => row.id}
				selectedIds={selectedIds}
				onSelectionChange={setSelectedIds}
				selectable
			/>
		);
	}
	render(<Table />);
	const all = screen.getByRole("checkbox", { name: "全选" });
	fireEvent.click(screen.getByRole("checkbox", { name: "选择行 1" }));
	expect(all.getAttribute("aria-checked")).toBe("mixed");
	fireEvent.click(all);
	expect(screen.getByRole("checkbox", { name: "选择行 2" }).getAttribute("aria-checked")).toBe(
		"true",
	);
	expect(all.getAttribute("aria-checked")).toBe("true");
	fireEvent.click(all);
	expect(all.getAttribute("aria-checked")).toBe("false");
});
