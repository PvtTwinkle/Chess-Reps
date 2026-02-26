// POST /api/drill/session — create a new drill session record when the user
// starts grading their first card.
//
// We record start time here and leave completed_at null. The client will PATCH
// the session via /api/drill/session/[id] when the session finishes.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { drillSession, repertoire } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const body = await request.json();
	const { repertoireId } = body;

	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId must be a number');

	// Verify the repertoire belongs to this user.
	const rep = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)))
		.get();

	if (!rep) throw error(404, 'Repertoire not found');

	const result = db
		.insert(drillSession)
		.values({
			userId: locals.user.id,
			repertoireId,
			cardsReviewed: 0,
			cardsCorrect: 0,
			startedAt: new Date()
		})
		.returning({ id: drillSession.id })
		.get();

	return json({ sessionId: result.id });
};
