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

/**
 * Hashes a password using PBKDF2-SHA256.
 * Output format: base64(salt) + "." + base64(hash)
 *
 * @param password - Plain text password
 * @returns Promise<string> - Hashed password with embedded salt
 */
export async function hashPassword(password: string): Promise<string> {
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);

	// Generate 16 bytes salt
	const salt = crypto.getRandomValues(new Uint8Array(16));

	// Derive 256-bit key using PBKDF2-SHA256
	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations: 100000,
			hash: "SHA-256",
		},
		keyMaterial,
		256,
	);

	// Store format: base64(salt) + "." + base64(hash)
	const saltB64 = btoa(String.fromCharCode(...salt));
	const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derivedBits)));

	return `${saltB64}.${hashB64}`;
}

/**
 * Verifies a password against a PBKDF2-SHA256 hash.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param input - User input password
 * @param storedHash - Hash stored in database (format: salt.hash)
 * @returns Promise<boolean> - true if password matches
 */
export async function verifyPassword(input: string, storedHash: string): Promise<boolean> {
	const parts = storedHash.split(".");
	if (parts.length !== 2) {
		return false;
	}

	const [saltB64, hashB64] = parts;

	try {
		const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
		const expectedHash = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));

		const encoder = new TextEncoder();
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			encoder.encode(input),
			"PBKDF2",
			false,
			["deriveBits"],
		);

		const derivedBits = await crypto.subtle.deriveBits(
			{
				name: "PBKDF2",
				salt,
				iterations: 100000,
				hash: "SHA-256",
			},
			keyMaterial,
			256,
		);

		const derivedArray = new Uint8Array(derivedBits);

		// Constant-time comparison to prevent timing attacks
		if (derivedArray.length !== expectedHash.length) {
			return false;
		}

		let match = 0;
		for (let i = 0; i < derivedArray.length; i++) {
			match |= derivedArray[i] ^ expectedHash[i];
		}

		return match === 0;
	} catch {
		return false;
	}
}
