// POST /api/review/save
//
// Save a reviewed game to the database.
// Called from the review page when the user clicks "Save Review".
// Returns the new reviewed_game.id.
//
// When importedGameId is provided, the save links back to the imported_game
// record by updating its status to 'reviewed' and copying source/playedAt metadata.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, reviewedGame, importedGame } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey } from '$lib/fen';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { repertoireId, pgn, deviationFen = null, notes = null, importedGameId } = body;

	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId must be a number');
	if (!pgn || typeof pgn !== 'string') throw error(400, 'pgn is required');

	// Verify the repertoire belongs to this user.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)));
	if (!rep) throw error(404, 'Repertoire not found');

	// If this review is linked to an imported game, look it up for metadata.
	let importedGameRow = null;
	if (typeof importedGameId === 'number') {
		const [ig] = await db
			.select()
			.from(importedGame)
			.where(and(eq(importedGame.id, importedGameId), eq(importedGame.userId, locals.user.id)));
		if (ig) importedGameRow = ig;
	}

	// Determine source and metadata from the imported game (or fall back to MANUAL).
	const source = importedGameRow?.source ?? 'MANUAL';
	const lichessGameId =
		importedGameRow?.source === 'LICHESS' ? importedGameRow.externalGameId : null;
	const playedAt = importedGameRow?.playedAt ?? null;

	const [saved] = await db
		.insert(reviewedGame)
		.values({
			userId: locals.user.id,
			repertoireId,
			pgn,
			source,
			lichessGameId,
			deviationFen: typeof deviationFen === 'string' ? fenKey(deviationFen) : null,
			playedAt,
			reviewedAt: new Date(),
			notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null
		})
		.returning();

	// Link the imported game back to this review.
	if (importedGameRow) {
		await db
			.update(importedGame)
			.set({
				status: 'reviewed',
				reviewedGameId: saved.id
			})
			.where(eq(importedGame.id, importedGameRow.id));
	}

	return json({ id: saved.id });
};
