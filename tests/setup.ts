/**
 * Bun test preload — mock server-only package so server-side modules
 * can be imported in test environment.
 */
import { mock } from "bun:test";

mock.module("server-only", () => ({}));
