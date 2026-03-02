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

	if (Object.keys(updates).length === 0) {
		throw error(400, 'No recognised settings fields provided');
	}

	updates.updatedAt = new Date();

	// Upsert: update if a row exists, insert a defaults row first if not.
	const existing = db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id))
		.get();

	if (existing) {
		db.update(userSettings).set(updates).where(eq(userSettings.userId, locals.user.id)).run();
	} else {
		// updatedAt is required on insert but lives in the partial `updates` object.
		// Provide it explicitly so Drizzle's types are satisfied.
		db.insert(userSettings)
			.values({ userId: locals.user.id, updatedAt: new Date(), ...updates })
			.run();
	}

	const updated = db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id))
		.get();

	return json({ updated: true, settings: updated });
};
