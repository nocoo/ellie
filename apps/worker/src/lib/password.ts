// Password utilities for Discuz legacy and PBKDF2-SHA256

import { MD5 } from "crypto-js";

/**
 * Verifies Discuz old password format.
 * Discuz: md5(md5(password) + salt)
 * Note: Uses plain MD5, not HMAC-MD5.
 *
 * @param input - User input password
 * @param storedHash - Hash stored in database
 * @param salt - Salt stored in database (password_salt column)
 * @returns Promise<boolean> - true if password matches
 */
export async function verifyDiscuzPassword(
	input: string,
	storedHash: string,
	salt: string,
): Promise<boolean> {
	const firstMd5 = MD5(input).toString();
	const doubleMd5 = MD5(firstMd5).toString();
	const finalHash = MD5(doubleMd5 + salt).toString();
	return finalHash === storedHash;
}
