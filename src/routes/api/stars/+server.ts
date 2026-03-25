// GET /api/stars?fen=<fen>&player=<slug>
//
// Returns move statistics for a specific famous player at the given position.
// Queries the local celebrity_moves table — no external API calls.
//
// The input FEN is normalized to 4 fields (stripping halfmove clock and
// fullmove number) to match the storage format.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { celebrityMoves } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import type { MastersMove, MastersResponse } from '../masters/+server';

const MAX_MOVES = 12;
const EMPTY_RESPONSE: MastersResponse = { moves: [], totalGames: 0 };

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const fen = url.searchParams.get('fen');
	if (!fen) throw error(400, 'fen query parameter is required');
	if (fen.length > 100) throw error(400, 'fen is too long');

	const player = url.searchParams.get('player');
	if (!player) throw error(400, 'player query parameter is required');
	if (player.length > 50) throw error(400, 'player slug is too long');

	const normalizedFen = fenKey(fen);

	const rows = await db
		.select()
		.from(celebrityMoves)
		.where(
			and(eq(celebrityMoves.positionFen, normalizedFen), eq(celebrityMoves.playerSlug, player))
		)
		.orderBy(desc(celebrityMoves.gamesPlayed))
		.limit(MAX_MOVES);

	if (rows.length === 0) return json(EMPTY_RESPONSE);

	const moves: MastersMove[] = rows.map((r) => ({
		san: r.moveSan,
		white: r.whiteWins,
		draws: r.draws,
		black: r.blackWins,
		totalGames: r.gamesPlayed
	}));

	const totalGames = moves.reduce((sum, m) => sum + m.totalGames, 0);

	return json({ moves, totalGames });
};
