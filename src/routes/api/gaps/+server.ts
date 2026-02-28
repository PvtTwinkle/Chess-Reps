// GET /api/gaps?repertoireId=X — find uncovered positions in a repertoire.
//
// Returns all "gaps" — opponent book moves that the user has no prepared
// response to. Each gap includes a deep-link line for Build Mode.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove, bookMove } from '$lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { computeGaps } from '$lib/gaps';

export const GET: RequestHandler = ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const repertoireIdParam = url.searchParams.get('repertoireId');
	if (!repertoireIdParam) throw error(400, 'repertoireId query parameter is required');

	const repertoireId = parseInt(repertoireIdParam);
	if (isNaN(repertoireId)) throw error(400, 'repertoireId must be a number');

	// Verify the repertoire exists and belongs to this user.
	const rep = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)))
		.get();

	if (!rep) throw error(404, 'Repertoire not found');

	// Load all user moves for this repertoire.
	const moves = db
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.userId, locals.user.id)))
		.all();

	// Identify opponent-turn positions and load matching book moves.
	const opponentTurnChar = rep.color === 'WHITE' ? 'b' : 'w';
	const opponentFens = [
		...new Set(
			moves.filter((m) => m.fromFen.split(' ')[1] === opponentTurnChar).map((m) => m.fromFen)
		)
	];

	const relevantBookMoves =
		opponentFens.length > 0
			? db.select().from(bookMove).where(inArray(bookMove.fromFen, opponentFens)).all()
			: [];

	const gaps = computeGaps(moves, relevantBookMoves, rep.color as 'WHITE' | 'BLACK');

	return json({ count: gaps.length, gaps });
};
