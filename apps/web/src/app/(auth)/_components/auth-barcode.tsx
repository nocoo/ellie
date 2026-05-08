// app/(auth)/_components/auth-barcode.tsx — Static decorative barcode strip
// used in the top-right of the AuthIdCard header. Pure visual decoration.

const BARS: ReadonlyArray<{ id: string; width: number; opacity: number }> = [
	2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1,
].map((w, i) => ({ id: `b${i}`, width: w * 1.5, opacity: i % 3 === 0 ? 0.9 : 0.5 }));

export function AuthBarcode() {
	return (
		<div className="flex items-stretch gap-[1.5px] h-full">
			{BARS.map((bar) => (
				<div
					key={bar.id}
					className="rounded-[0.5px] bg-primary-foreground"
					style={{ width: `${bar.width}px`, opacity: bar.opacity }}
				/>
			))}
		</div>
	);
}
