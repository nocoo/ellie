// hooks/use-pagination.ts — Keyset cursor pagination state management
// Ref: 04b §共享布局组件 — Pagination
// Works with PaginatedResult<T> from data/repositories/types.ts

"use client";

import { useCallback, useState } from "react";

export interface PaginationState {
	cursor: string | null;
	direction: "forward" | "backward";
}

export interface UsePaginationReturn {
	/** Current pagination state to pass to repository list() calls */
	state: PaginationState;
	/** Load next page using the nextCursor from latest result */
	loadMore(nextCursor: string): void;
	/** Load previous page using the prevCursor from latest result */
	loadPrev(prevCursor: string): void;
	/** Reset to first page */
	reset(): void;
	/** Whether we're past the first page */
	hasPreviousPage: boolean;
}

const INITIAL_STATE: PaginationState = {
	cursor: null,
	direction: "forward",
};

export function usePagination(): UsePaginationReturn {
	const [state, setState] = useState<PaginationState>(INITIAL_STATE);

	const loadMore = useCallback((nextCursor: string) => {
		setState({ cursor: nextCursor, direction: "forward" });
	}, []);

	const loadPrev = useCallback((prevCursor: string) => {
		setState({ cursor: prevCursor, direction: "backward" });
	}, []);

	const reset = useCallback(() => {
		setState(INITIAL_STATE);
	}, []);

	return {
		state,
		loadMore,
		loadPrev,
		reset,
		hasPreviousPage: state.cursor !== null,
	};
}
