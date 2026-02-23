// Authentication helpers — session creation, validation, and deletion.
//
// A session is a row in the `session` table that links a random token (UUID)
// to a user ID. The token is stored as a cookie in the browser.
//
// All functions here are synchronous because better-sqlite3 is synchronous.
// There are no async/await patterns here — reads and writes happen immediately.

import crypto from 'crypto';
import { db } from '$lib/db';
import { session } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// The cookie name. Must match exactly between the code that sets the cookie
// (login action) and the code that reads it (hooks.server.ts).
export const SESSION_COOKIE_NAME = 'chess_reps_session';

// Sessions are valid for 30 days. After this, the user must log in again.
const SESSION_DURATION_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// createSession(userId)
//
// Called after a successful login. Creates a new row in the session table and
// returns the random token that should be stored in the browser cookie.
//
// crypto.randomUUID() generates a cryptographically random UUID like:
//   "f47ac10b-58cc-4372-a567-0e02b2c3d479"
// This is unpredictable enough that an attacker cannot guess it.
// ─────────────────────────────────────────────────────────────────────────────

export function createSession(userId: number): string {
	const token = crypto.randomUUID();

	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

	db.insert(session).values({ id: token, userId, expiresAt }).run();

	return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSession(token)
//
// Called on every request by hooks.server.ts. Looks up the token in the
// session table. Returns the userId if the session exists and has not expired,
// or null if it is invalid/expired.
//
// Expired sessions are deleted immediately when discovered — this keeps the
// session table from accumulating stale rows over time.
// ─────────────────────────────────────────────────────────────────────────────

export function validateSession(token: string): { userId: number } | null {
	const row = db.select().from(session).where(eq(session.id, token)).get();

	if (!row) {
		// Token not found in the database — invalid or already deleted.
		return null;
	}

	if (row.expiresAt < new Date()) {
		// Token exists but has passed its expiry date — delete and reject.
		db.delete(session).where(eq(session.id, token)).run();
		return null;
	}

	return { userId: row.userId };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteSession(token)
//
// Called on logout. Removes the session row from the database so the token
// is immediately invalid — even if the browser still has the cookie.
// ─────────────────────────────────────────────────────────────────────────────

export function deleteSession(token: string): void {
	db.delete(session).where(eq(session.id, token)).run();
}
