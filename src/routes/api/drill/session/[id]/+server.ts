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
	const userId = locals.user.id;

	const sessionId = parseInt(params.id, 10);
	if (isNaN(sessionId)) throw error(400, 'Invalid session id');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { cardsReviewed, cardsCorrect } = body;

	if (!Number.isInteger(cardsReviewed) || cardsReviewed < 0 || cardsReviewed > 10000) {
		throw error(400, 'cardsReviewed must be a non-negative integer (max 10000)');
	}
	if (!Number.isInteger(cardsCorrect) || cardsCorrect < 0 || cardsCorrect > cardsReviewed) {
		throw error(400, 'cardsCorrect must be a non-negative integer <= cardsReviewed');
	}

	const now = new Date();

	// Wrap in a transaction to prevent double-finalization from rapid duplicate
	// submissions (e.g. user double-clicks "Finish"). The guard on completedAt
	// ensures only the first request writes stats.
	const result = await db.transaction(async (tx) => {
		const [sess] = await tx
			.select()
			.from(drillSession)
			.where(and(eq(drillSession.id, sessionId), eq(drillSession.userId, userId)));

		if (!sess) throw error(404, 'Session not found');

		// Already finalized — return existing result without re-writing.
		if (sess.completedAt) {
			const [nextResult] = await tx
				.select({ nextDue: min(userRepertoireMove.due) })
				.from(userRepertoireMove)
				.where(
					and(
						eq(userRepertoireMove.userId, userId),
						eq(userRepertoireMove.repertoireId, sess.repertoireId),
						gt(userRepertoireMove.due, now)
					)
				);
			return { nextDueAt: nextResult?.nextDue ? nextResult.nextDue.toISOString() : null };
		}

		// Finalize the session.
		await tx
			.update(drillSession)
			.set({ completedAt: now, cardsReviewed, cardsCorrect })
			.where(eq(drillSession.id, sessionId));

		// Find the next due card for this repertoire so the end screen can say
		// "Next session: tomorrow at 2pm" or similar.
		const [nextResult] = await tx
			.select({ nextDue: min(userRepertoireMove.due) })
			.from(userRepertoireMove)
			.where(
				and(
					eq(userRepertoireMove.userId, userId),
					eq(userRepertoireMove.repertoireId, sess.repertoireId),
					gt(userRepertoireMove.due, now)
				)
			);

		return { nextDueAt: nextResult?.nextDue ? nextResult.nextDue.toISOString() : null };
	});

	return json(result);
};
