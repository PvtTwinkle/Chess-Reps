// POST /api/drill/undo — restore a drill card's FSRS state to its pre-grade snapshot.
//
// When a user grades a card and immediately regrets it (before clicking "Next"),
// the client sends back the snapshot of FSRS fields it captured before grading.
// We validate ownership and write those fields back, effectively undoing the grade.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { cardId, previousState } = body;

	if (typeof cardId !== 'number') throw error(400, 'cardId must be a number');
	if (!previousState || typeof previousState !== 'object') {
		throw error(400, 'previousState is required');
	}

	// Verify the card belongs to this user.
	const [card] = await db
		.select({ id: userRepertoireMove.id })
		.from(userRepertoireMove)
		.where(and(eq(userRepertoireMove.id, cardId), eq(userRepertoireMove.userId, locals.user.id)));

	if (!card) throw error(404, 'Card not found');

	// Restore the pre-grade FSRS fields.
	await db
		.update(userRepertoireMove)
		.set({
			due: previousState.due ? new Date(previousState.due) : null,
			stability: previousState.stability ?? null,
			difficulty: previousState.difficulty ?? null,
			elapsedDays: previousState.elapsedDays ?? null,
			scheduledDays: previousState.scheduledDays ?? null,
			reps: previousState.reps ?? null,
			lapses: previousState.lapses ?? null,
			state: previousState.state ?? null,
			lastReview: previousState.lastReview ? new Date(previousState.lastReview) : null,
			learningSteps: previousState.learningSteps ?? 0
		})
		.where(eq(userRepertoireMove.id, cardId));

	return json({ restored: true });
};
