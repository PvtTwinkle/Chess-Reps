// POST /api/review/save
//
// Save a reviewed game to the database.
// Called from the review page when the user clicks "Save Review".
// Returns the new reviewed_game.id.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, reviewedGame } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const body = await request.json();
	const { repertoireId, pgn, deviationFen = null, notes = null } = body;

	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId must be a number');
	if (!pgn || typeof pgn !== 'string') throw error(400, 'pgn is required');

	// Verify the repertoire belongs to this user.
	const rep = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)))
		.get();
	if (!rep) throw error(404, 'Repertoire not found');

	const saved = db
		.insert(reviewedGame)
		.values({
			userId: locals.user.id,
			repertoireId,
			pgn,
			source: 'MANUAL',
			lichessGameId: null,
			deviationFen: typeof deviationFen === 'string' ? deviationFen : null,
			playedAt: null,
			reviewedAt: new Date(),
			notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null
		})
		.returning()
		.get();

	return json({ id: saved.id });
};
