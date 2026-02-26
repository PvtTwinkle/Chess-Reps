// PATCH /api/drill/session/[id] — finalize a drill session when all cards have
// been reviewed. Sets completed_at, writes final stats, and returns the time
// of the next due card so the end screen can show "Next session: tomorrow at 2pm".

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { drillSession, userRepertoireMove } from '$lib/db/schema';
import { eq, and, gt, min } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const sessionId = parseInt(params.id, 10);
	if (isNaN(sessionId)) throw error(400, 'Invalid session id');

	const body = await request.json();
	const { cardsReviewed, cardsCorrect } = body;

	if (typeof cardsReviewed !== 'number') throw error(400, 'cardsReviewed must be a number');
	if (typeof cardsCorrect !== 'number') throw error(400, 'cardsCorrect must be a number');

	// Load the session and verify it belongs to this user.
	const sess = db
		.select()
		.from(drillSession)
		.where(and(eq(drillSession.id, sessionId), eq(drillSession.userId, locals.user.id)))
		.get();

	if (!sess) throw error(404, 'Session not found');

	const now = new Date();

	// Finalize the session.
	db.update(drillSession)
		.set({ completedAt: now, cardsReviewed, cardsCorrect })
		.where(eq(drillSession.id, sessionId))
		.run();

	// Find the next due card for this repertoire so the end screen can say
	// "Next session: tomorrow at 2pm" or similar.
	const nextResult = db
		.select({ nextDue: min(userRepertoireMove.due) })
		.from(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, locals.user.id),
				eq(userRepertoireMove.repertoireId, sess.repertoireId),
				gt(userRepertoireMove.due, now)
			)
		)
		.get();

	const nextDueAt = nextResult?.nextDue ? nextResult.nextDue.toISOString() : null;

	return json({ nextDueAt });
};
