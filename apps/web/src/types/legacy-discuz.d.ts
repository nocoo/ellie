// Type augmentation for the legacy Discuz globals stubbed in
// `lib/legacy-discuz-stubs.ts`. Keeps `window.thumbImg` etc. typed where
// our own code touches them (e.g. tests that inspect installed stubs)
// without leaking these names as required globals — they remain optional.

declare global {
	interface Window {
		thumbImg?: (...args: unknown[]) => void;
		attachimg?: (...args: unknown[]) => void;
		img_onmouseoverfunc?: (...args: unknown[]) => void;
	}
}

export {};
