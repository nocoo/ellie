// JWT utilities for HS256 signing and verification

export interface JwtPayload {
	userId: number;
	role: number;
	exp: number;
	iat?: number;
}

/**
 * Creates a JWT token with HS256 algorithm.
 *
 * @param payload - JWT payload (userId, role, exp)
 * @param secret - Secret key for signing
 * @returns Promise<string> - Signed JWT token
 */
export async function createJwt(payload: Omit<JwtPayload, "iat">, secret: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const fullPayload: JwtPayload = {
		...payload,
		iat: now,
	};

	// Encode header
	const header = { alg: "HS256", typ: "JWT" };
	const encodedHeader = base64UrlEncode(JSON.stringify(header));

	// Encode payload
	const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

	// Create signature
	const data = `${encodedHeader}.${encodedPayload}`;
	const signature = await sign(data, secret);
	const encodedSignature = base64UrlEncode(signature);

	return `${data}.${encodedSignature}`;
}

/**
 * Verifies a JWT token and returns the payload.
 *
 * @param token - JWT token to verify
 * @param secret - Secret key for verification
 * @returns Promise<JwtPayload> - Decoded payload if valid
 * @throws Error if token is invalid or signature doesn't match
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("Invalid token format");
	}

	const [encodedHeader, encodedPayload, encodedSignature] = parts;

	// Verify signature
	const data = `${encodedHeader}.${encodedPayload}`;
	const expectedSignature = await sign(data, secret);
	const encodedExpectedSignature = base64UrlEncode(expectedSignature);

	if (encodedSignature !== encodedExpectedSignature) {
		throw new Error("Invalid signature");
	}

	// Decode payload
	const payload = JSON.parse(
		new TextDecoder().decode(base64UrlDecode(encodedPayload ?? "")),
	) as JwtPayload;

	return payload;
}

/**
 * Checks if a JWT token is expired.
 *
 * @param payload - JWT payload
 * @returns boolean - true if expired, false otherwise
 */
export function isTokenExpired(payload: JwtPayload): boolean {
	return payload.exp < Math.floor(Date.now() / 1000);
}

/**
 * Signs data using HMAC-SHA256.
 */
async function sign(data: string, secret: string): Promise<Uint8Array> {
	const encoder = new TextEncoder();

	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));

	return new Uint8Array(signature);
}

/**
 * Encodes a string to base64url format.
 */
function base64UrlEncode(input: string | Uint8Array): string {
	let bytes: Uint8Array;
	if (typeof input === "string") {
		bytes = new TextEncoder().encode(input);
	} else {
		bytes = input;
	}

	const base64 = btoa(String.fromCharCode(...bytes));
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decodes a base64url string to bytes.
 */
function base64UrlDecode(input: string): Uint8Array {
	// Add padding if needed
	const padded = input + "=".repeat((4 - (input.length % 4)) % 4);

	// Convert base64url to base64
	const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");

	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	return bytes;
}
