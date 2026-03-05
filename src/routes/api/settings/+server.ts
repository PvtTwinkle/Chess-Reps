// PATCH /api/settings — update one or more user settings fields.
//
// Supports: { soundEnabled: boolean, stockfishDepth: number, stockfishTimeout: number, boardTheme: string }
// Returns the updated settings row.
//
// The user must be authenticated; settings are scoped to locals.user.id.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	// Build an update object with only the fields we recognise and received.
	// This pattern makes it easy to extend with more settings later without
	// changing the logic — just add a new recognised field here.
	const updates: Partial<typeof userSettings.$inferInsert> = {};

	if (typeof body.soundEnabled === 'boolean') {
		updates.soundEnabled = body.soundEnabled;
	}

	// Stockfish analysis depth: integer clamped to 15–30.
	if (typeof body.stockfishDepth === 'number') {
		updates.stockfishDepth = Math.max(15, Math.min(30, Math.round(body.stockfishDepth)));
	}

	// Stockfish analysis timeout: integer clamped to 3–30 seconds.
	if (typeof body.stockfishTimeout === 'number') {
		updates.stockfishTimeout = Math.max(3, Math.min(30, Math.round(body.stockfishTimeout)));
	}

	// Board theme: must be one of the known theme names.
	const VALID_THEMES = ['brown', 'blue', 'green', 'purple', 'grey'];
	if (typeof body.boardTheme === 'string' && VALID_THEMES.includes(body.boardTheme)) {
		updates.boardTheme = body.boardTheme;
	}

	// Lichess username: alphanumeric + hyphens + underscores, max 25 chars.
	// Empty string or null clears the username.
	if (body.lichessUsername !== undefined) {
		if (body.lichessUsername === null || body.lichessUsername === '') {
			updates.lichessUsername = null;
		} else if (typeof body.lichessUsername === 'string') {
			const cleaned = body.lichessUsername.trim();
			if (cleaned.length > 0 && cleaned.length <= 25 && /^[a-zA-Z0-9_-]+$/.test(cleaned)) {
				updates.lichessUsername = cleaned;
			}
		}
	}

	// Chess.com username: same validation pattern.
	if (body.chesscomUsername !== undefined) {
		if (body.chesscomUsername === null || body.chesscomUsername === '') {
			updates.chesscomUsername = null;
		} else if (typeof body.chesscomUsername === 'string') {
			const cleaned = body.chesscomUsername.trim();
			if (cleaned.length > 0 && cleaned.length <= 25 && /^[a-zA-Z0-9_-]+$/.test(cleaned)) {
				updates.chesscomUsername = cleaned;
			}
		}
	}

	// Puzzle goal count: positive integer 1–999, or null to clear the goal.
	if (body.puzzleGoalCount !== undefined) {
		if (body.puzzleGoalCount === null) {
			updates.puzzleGoalCount = null;
			updates.puzzleGoalFrequency = null;
		} else if (typeof body.puzzleGoalCount === 'number') {
			updates.puzzleGoalCount = Math.max(1, Math.min(999, Math.round(body.puzzleGoalCount)));
		}
	}

	// Puzzle goal frequency: must be one of the known period names.
	const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly'];
	if (
		typeof body.puzzleGoalFrequency === 'string' &&
		VALID_FREQUENCIES.includes(body.puzzleGoalFrequency)
	) {
		updates.puzzleGoalFrequency = body.puzzleGoalFrequency;
	}

	if (Object.keys(updates).length === 0) {
		throw error(400, 'No recognised settings fields provided');
	}

	updates.updatedAt = new Date();

	// Upsert: update if a row exists, insert a defaults row first if not.
	const [existing] = await db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));

	if (existing) {
		await db.update(userSettings).set(updates).where(eq(userSettings.userId, locals.user.id));
	} else {
		// updatedAt is required on insert but lives in the partial `updates` object.
		// Provide it explicitly so Drizzle's types are satisfied.
		await db
			.insert(userSettings)
			.values({ userId: locals.user.id, updatedAt: new Date(), ...updates });
	}

	const [updated] = await db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));

	return json({ updated: true, settings: updated });
};
