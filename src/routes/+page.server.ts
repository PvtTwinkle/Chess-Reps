// Dashboard page server load.
//
// The layout's +layout.server.ts already fetches the user's repertoires list
// on every request. Rather than querying the database a second time, we call
// parent() here to get that data and pass the repertoires array into the page.
//
// Additionally, we compute "gaps" — positions where the opening book has moves
// that the user hasn't prepared responses for — and surface them as a widget.

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { userMove, bookMove } from '$lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { computeGaps } from '$lib/gaps';
import type { Gap } from '$lib/gaps';

export const load: PageServerLoad = async ({ parent }) => {
	const { repertoires, activeRepertoireId } = await parent();

	// No active repertoire → no gaps to compute.
	if (!activeRepertoireId || repertoires.length === 0) {
		return { repertoires, gaps: [] as Gap[] };
	}

	// Find the active repertoire's color.
	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		return { repertoires, gaps: [] as Gap[] };
	}

	// Load all user moves for the active repertoire.
	const moves = db
		.select()
		.from(userMove)
		.where(
			and(eq(userMove.repertoireId, activeRepertoireId), eq(userMove.userId, activeRep.userId))
		)
		.all();

	if (moves.length === 0) {
		return { repertoires, gaps: [] as Gap[] };
	}

	// Identify opponent-turn positions and load matching book moves.
	const opponentTurnChar = activeRep.color === 'WHITE' ? 'b' : 'w';
	const opponentFens = [
		...new Set(
			moves.filter((m) => m.fromFen.split(' ')[1] === opponentTurnChar).map((m) => m.fromFen)
		)
	];

	const relevantBookMoves =
		opponentFens.length > 0
			? db.select().from(bookMove).where(inArray(bookMove.fromFen, opponentFens)).all()
			: [];

	const gaps = computeGaps(moves, relevantBookMoves, activeRep.color as 'WHITE' | 'BLACK');

	return { repertoires, gaps };
};
