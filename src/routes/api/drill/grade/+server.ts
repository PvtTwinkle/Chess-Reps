// POST /api/drill/grade — apply a rating to a drill card and update its SR state.
//
// The client sends the card ID and the user's rating (Forgot=1, Unsure=3, Easy=4).
// We load the card, run the FSRS algorithm to compute the next due date and
// updated memory state, then write the result back to user_repertoire_move.
//
// The card must belong to the requesting user — we verify ownership before
// touching anything.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userRepertoireMove } from '$lib/db/schema';
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
	const { cardId, rating } = body;

	// Validate inputs.
	if (typeof cardId !== 'number') throw error(400, 'cardId must be a number');
	if (![Rating.Again, Rating.Good, Rating.Easy].includes(rating)) {
		throw error(400, 'rating must be 1 (Forgot), 3 (Unsure), or 4 (Easy)');
	}

	// Load the card and verify it belongs to this user.
	const [card] = await db
		.select()
		.from(userRepertoireMove)
		.where(and(eq(userRepertoireMove.id, cardId), eq(userRepertoireMove.userId, locals.user.id)));

	if (!card) throw error(404, 'Card not found');

	// Run the FSRS algorithm to get the updated memory state.
	const now = new Date();
	const updated = gradeCard(card, rating as Rating, now);

	// Write the new state back to the database.
	await db.update(userRepertoireMove).set(updated).where(eq(userRepertoireMove.id, cardId));

	return json({ updated: true, due: updated.due });
};
