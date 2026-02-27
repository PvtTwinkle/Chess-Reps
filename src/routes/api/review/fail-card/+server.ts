// POST /api/review/fail-card
//
// Apply an FSRS "Again" rating to the SR card for a specific repertoire position.
// Called from the game review page when the user identifies a DEVIATION — the
// deviation counts as a failed drill card, so the position will resurface soon.
//
// If no SR card exists for the given position (possible if the card was deleted,
// or predates FSRS), a new one is created in a due state so it appears promptly.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { gradeCard, Rating } from '$lib/fsrs';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { repertoireId, fromFen } = body;

	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId must be a number');
	if (!fromFen || typeof fromFen !== 'string') throw error(400, 'fromFen is required');

	// Verify the repertoire belongs to this user.
	const rep = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)))
		.get();
	if (!rep) throw error(404, 'Repertoire not found');

	// Look up the SR card for this position.
	const card = db
		.select()
		.from(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, locals.user.id),
				eq(userRepertoireMove.repertoireId, repertoireId),
				eq(userRepertoireMove.fromFen, fromFen)
			)
		)
		.get();

	const now = new Date();

	if (card) {
		// Card exists — apply Again rating via FSRS.
		const updated = gradeCard(card, Rating.Again, now);
		db.update(userRepertoireMove).set(updated).where(eq(userRepertoireMove.id, card.id)).run();
		return json({ updated: true, due: updated.due });
	}

	// No SR card exists — find the corresponding userMove to get the SAN,
	// then create a new card in an immediately-due state.
	const moveRow = db
		.select()
		.from(userMove)
		.where(
			and(
				eq(userMove.userId, locals.user.id),
				eq(userMove.repertoireId, repertoireId),
				eq(userMove.fromFen, fromFen)
			)
		)
		.get();

	if (!moveRow) {
		// No move at this position — can't create a card, but it's not an error.
		return json({ updated: false, reason: 'No move found for this position' });
	}

	db.insert(userRepertoireMove)
		.values({
			userId: locals.user.id,
			repertoireId,
			fromFen,
			san: moveRow.san,
			due: now,
			state: 0, // New — will enter the learning phase on first drill
			reps: 0,
			lapses: 0,
			stability: null,
			difficulty: null,
			elapsedDays: null,
			scheduledDays: null,
			lastReview: null,
			learningSteps: 0
		})
		.run();

	return json({ updated: true, due: now });
};
