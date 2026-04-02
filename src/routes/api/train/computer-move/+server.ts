// GET /api/train/computer-move?fen=<fen>&source=players|masters&rating=<0-7>
//
// Selects a single computer move weighted by popularity from the Lichess open
// database (players) or the Chessmont masters database. The probability of
// selecting a move is proportional to its gamesPlayed count — moves that are
// played more often in real games are chosen more frequently.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lichessMoves, chessmontMoves } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey } from '$lib/fen';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const fen = url.searchParams.get('fen');
	if (!fen) throw error(400, 'fen query parameter is required');
	if (fen.length > 100) throw error(400, 'fen is too long');

	const source = url.searchParams.get('source') ?? 'players';
	if (source !== 'players' && source !== 'masters') {
		throw error(400, 'source must be "players" or "masters"');
	}

	const normalizedFen = fenKey(fen);

	let rows: { moveSan: string; resultingFen: string; gamesPlayed: number }[];

	if (source === 'players') {
		const ratingParam = url.searchParams.get('rating');
		if (ratingParam === null) throw error(400, 'rating query parameter is required for players');
		const rating = parseInt(ratingParam, 10);
		if (isNaN(rating) || rating < 0 || rating > 7) throw error(400, 'rating must be 0-7');

		rows = await db
			.select({
				moveSan: lichessMoves.moveSan,
				resultingFen: lichessMoves.resultingFen,
				gamesPlayed: lichessMoves.gamesPlayed
			})
			.from(lichessMoves)
			.where(
				and(eq(lichessMoves.positionFen, normalizedFen), eq(lichessMoves.ratingBracket, rating))
			);
	} else {
		rows = await db
			.select({
				moveSan: chessmontMoves.moveSan,
				resultingFen: chessmontMoves.resultingFen,
				gamesPlayed: chessmontMoves.gamesPlayed
			})
			.from(chessmontMoves)
			.where(eq(chessmontMoves.positionFen, normalizedFen));
	}

	if (rows.length === 0) {
		return json({ noMoves: true });
	}

	// Weighted random selection: probability proportional to gamesPlayed
	const totalGames = rows.reduce((sum, r) => sum + r.gamesPlayed, 0);
	const roll = Math.random() * totalGames;

	let cumulative = 0;
	for (const row of rows) {
		cumulative += row.gamesPlayed;
		if (roll < cumulative) {
			return json({
				san: row.moveSan,
				resultingFen: row.resultingFen,
				gamesPlayed: row.gamesPlayed,
				totalGames
			});
		}
	}

	// Fallback (should not reach here due to floating point, but just in case)
	const last = rows[rows.length - 1];
	return json({
		san: last.moveSan,
		resultingFen: last.resultingFen,
		gamesPlayed: last.gamesPlayed,
		totalGames
	});
};
