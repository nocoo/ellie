export function handleSubmitShortcut(event: KeyboardEvent, submit: () => void): boolean {
	if (
		event.key !== "Enter" ||
		(!event.ctrlKey && !event.metaKey) ||
		event.altKey ||
		event.shiftKey ||
		event.isComposing ||
		event.keyCode === 229
	) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	if (!event.repeat) submit();
	return true;
}
