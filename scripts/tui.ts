#!/usr/bin/env bun
/// <reference types="bun-types" />

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read API_KEY from .dev.vars
const devVarsPath = resolve(import.meta.dir, "../.dev.vars");
const devVars = readFileSync(devVarsPath, "utf-8");
const match = devVars.match(/^API_KEY=(.+)$/m);
const apiKey = match?.[1]?.trim();

if (!apiKey) {
	console.error("Error: API_KEY not found in .dev.vars");
	process.exit(1);
}

// Spawn ellie-tui with API_KEY in environment
const tuiPath = resolve(import.meta.dir, "../packages/cli-rs/target/release/ellie-tui");

const child = spawn(tuiPath, {
	stdio: "inherit",
	env: { ...process.env, ELLIE_API_KEY: apiKey },
});

child.on("exit", (code) => process.exit(code ?? 0));
