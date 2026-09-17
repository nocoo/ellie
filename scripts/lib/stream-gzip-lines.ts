import { spawn } from "node:child_process";

/**
 * Stream-parse a gzipped dump and yield rows for a target table.
 *
 * We avoid node:zlib + node:readline because the 5/14 monolithic dump
 * contains 1-row-per-INSERT lines around 1MB; the readline transform
 * deadlocks on these (observed: main thread parked in kevent64 forever).
 * Instead we spawn `gunzip -c` and consume stdout via a buffer-and-split
 * loop, which has no per-line size assumption.
 */
export async function* streamGzipLines(path: string): AsyncGenerator<string> {
	const child = spawn("gunzip", ["-c", path], { stdio: ["ignore", "pipe", "inherit"] });
	const stdout = child.stdout;
	if (!stdout) throw new Error("gunzip stdout not available");
	// A short-lived child can exit before stdout is drained. Capture its
	// result now; storing errors as values avoids an unhandled rejection
	// while the caller is still consuming lines.
	const completion = new Promise<Error | null>((resolve) => {
		child.once("exit", (code, signal) => {
			resolve(code === 0 ? null : new Error(`gunzip exited with ${signal ?? `code ${code}`}`));
		});
		child.once("error", (error) => {
			stdout.destroy(error);
			resolve(error);
		});
	});
	try {
		let buf = "";
		for await (const chunk of stdout) {
			buf += (chunk as Buffer).toString("utf8");
			let nl = buf.indexOf("\n");
			while (nl >= 0) {
				yield buf.substring(0, nl);
				buf = buf.substring(nl + 1);
				nl = buf.indexOf("\n");
			}
		}
		if (buf.length > 0) yield buf;
		const error = await completion;
		if (error) throw error;
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill();
	}
}
