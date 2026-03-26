/**
 * Password field mapper.
 *
 * Per docs/02-database-schema.md password verification section:
 * - DZ stores: md5(md5(password) + salt)
 * - Migration: direct pass-through of hash + salt
 * - Post-login: silently upgrade to argon2id and clear salt
 */

import { createHash } from "node:crypto";

/** Password data from DZ uc_members table. */
export interface DzPassword {
	/** md5(md5(password) + salt) — 32-char hex string */
	hash: string;
	/** 6-char random salt */
	salt: string;
}

/** Password data for Ellie users table. */
export interface ElliePassword {
	passwordHash: string;
	passwordSalt: string;
}

/**
 * Map DZ password fields to Ellie format.
 * Direct pass-through — no transformation needed during migration.
 */
export function mapPassword(dz: DzPassword): ElliePassword {
	return {
		passwordHash: dz.hash,
		passwordSalt: dz.salt,
	};
}

/**
 * Verify a plaintext password against a DZ-format hash.
 *
 * Algorithm: stored_hash == md5(md5(user_input) + stored_salt)
 *
 * @param input - User-provided plaintext password
 * @param storedHash - Stored hash (32-char hex)
 * @param storedSalt - Stored salt (6-char string)
 * @returns true if password matches
 */
export function verifyDzPassword(input: string, storedHash: string, storedSalt: string): boolean {
	const innerMd5 = createHash("md5").update(input).digest("hex");
	const outerMd5 = createHash("md5").update(`${innerMd5}${storedSalt}`).digest("hex");
	return outerMd5 === storedHash;
}
