import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { streamGzipLines } from "../../scripts/lib/stream-gzip-lines";

vi.mock("node:child_process", { spy: true });

afterEach(() => vi.mocked(childProcess.spawn).mockReset());

test("observes gunzip exit before stdout finishes, retaining every line", async () => {
	const stdout = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		exitCode: 0,
		signalCode: null,
		kill: vi.fn(),
	});
	vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as childProcess.ChildProcess);
	const lines: string[] = [];
	const reading = (async () => {
		for await (const line of streamGzipLines("fixture.gz")) lines.push(line);
	})();
	// A real child's exit can precede the final stdout read. Keep that
	// ordering deterministic instead of relying on a tiny gzip process race.
	child.emit("exit", 0, null);
	stdout.end("first\nsecond\nlast-without-newline");
	await reading;
	expect(lines).toEqual(["first", "second", "last-without-newline"]);
}, 1000);

test.each([
	[2, null, "code 2"],
	[null, "SIGTERM", "SIGTERM"],
] as const)("rejects failed decompression: %s / %s", async (code, signal, message) => {
	const stdout = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		exitCode: code,
		signalCode: signal,
		kill: vi.fn(),
	});
	vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as childProcess.ChildProcess);
	const reading = streamGzipLines("fixture.gz").next();
	const rejected = expect(reading).rejects.toThrow(message);
	child.emit("exit", code, signal);
	stdout.end();
	await rejected;
});

test("propagates spawn errors while stdout is open", async () => {
	const stdout = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		exitCode: null,
		signalCode: null,
		kill: vi.fn(),
	});
	vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as childProcess.ChildProcess);
	const reading = streamGzipLines("fixture.gz").next();
	const rejected = expect(reading).rejects.toThrow("spawn gunzip ENOENT");
	child.emit("error", new Error("spawn gunzip ENOENT"));
	await rejected;
	expect(child.kill).toHaveBeenCalledOnce();
});

test("stops an active child when the caller stops consuming lines", async () => {
	const stdout = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		exitCode: null,
		signalCode: null,
		kill: vi.fn(),
	});
	vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as childProcess.ChildProcess);
	const lines = streamGzipLines("fixture.gz");
	const first = lines.next();
	stdout.write("first\n");
	expect(await first).toEqual({ done: false, value: "first" });
	await lines.return(undefined);
	expect(child.kill).toHaveBeenCalledOnce();
});
