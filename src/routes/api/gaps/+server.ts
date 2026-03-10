// GET /api/gaps?repertoireId=X — find uncovered positions in a repertoire.
//
// Returns all "gaps" — opponent book moves that the user has no prepared
// response to. Each gap includes a deep-link line for Build Mode.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove, bookMove, chessmontMoves, userSettings } from '$lib/db/schema';
import { eq, and, inArray, desc, gte } from 'drizzle-orm';
import { computeGaps, fenKey } from '$lib/gaps';
import { getEffectiveStartFens } from '$lib/repertoire';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const repertoireIdParam = url.searchParams.get('repertoireId');
	if (!repertoireIdParam) throw error(400, 'repertoireId query parameter is required');

	const repertoireId = parseInt(repertoireIdParam);
	if (isNaN(repertoireId)) throw error(400, 'repertoireId must be a number');

	// Verify the repertoire exists and belongs to this user.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)));

	if (!rep) throw error(404, 'Repertoire not found');

	// Load all user moves for this repertoire.
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.userId, locals.user.id)));

	// Identify opponent-turn positions.
	const opponentTurnChar = rep.color === 'WHITE' ? 'b' : 'w';
	const opponentFens = [
		...new Set(
			moves.filter((m) => m.fromFen.split(' ')[1] === opponentTurnChar).map((m) => m.fromFen)
		)
	];

	// Normalize to 4-field FEN keys for masters table lookup.
	const opponentFenKeys = [...new Set(opponentFens.map(fenKey))];

	// Read the user's gap threshold setting (default 1000).
	const [userSettingsRow] = await db
		.select({ gapMinGames: userSettings.gapMinGames })
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));
	const MIN_MASTER_GAMES = userSettingsRow?.gapMinGames ?? 1000;
	const mastersMoves =
		opponentFenKeys.length > 0
			? await db
					.select()
					.from(chessmontMoves)
					.where(
						and(
							inArray(chessmontMoves.positionFen, opponentFenKeys),
							gte(chessmontMoves.gamesPlayed, MIN_MASTER_GAMES)
						)
					)
					.orderBy(desc(chessmontMoves.gamesPlayed))
			: [];

	// Track which positions have masters data so we can fall back to book for the rest.
	const mastersPositions = new Set(mastersMoves.map((m) => m.positionFen));

	// Fall back to book moves for positions without masters data.
	const bookFallbackFens = opponentFens.filter((f) => !mastersPositions.has(fenKey(f)));
	const relevantBookMoves =
		bookFallbackFens.length > 0
			? await db.select().from(bookMove).where(inArray(bookMove.fromFen, bookFallbackFens))
			: [];

	// Map masters rows to the MoveRow shape expected by computeGaps.
	const mastersAsMoveRows = mastersMoves.map((m) => ({
		fromFen: m.positionFen,
		toFen: m.resultingFen,
		san: m.moveSan,
		gamesPlayed: m.gamesPlayed
	}));

	const allOpponentMoves = [...mastersAsMoveRows, ...relevantBookMoves];

	const startFens = getEffectiveStartFens(
		rep.startFen ?? null,
		moves,
		rep.color as 'WHITE' | 'BLACK'
	);
	const gaps = computeGaps(moves, allOpponentMoves, rep.color as 'WHITE' | 'BLACK', startFens);

	return json({ count: gaps.length, gaps });
};
