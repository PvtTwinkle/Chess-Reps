// POST /api/prep/:id/refresh — fetch new games since the last watermark.
//
// Step 1: Returns PGN strings for client-side worker parsing (same as /api/prep/fetch).
// Step 2: Client re-parses and calls POST /api/prep/:id/merge with new aggregated data.
//
// This endpoint only handles Step 1. The merge is a separate endpoint to keep
// the request/response cycle simple (worker parsing happens client-side).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { opponentPreps, opponentMoves } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fetchLichessGames, LichessApiError } from '$lib/lichess';
import { fetchChesscomGames, ChesscomApiError } from '$lib/chesscom';
import { fenKey } from '$lib/fen';
import { timeWindowToSince } from '$lib/prep/timeWindow';
import type { AggregatedMove } from '$lib/prep/types';

// ── POST (mode: fetch) — return new PGNs since watermark ─────────────────────
// ── POST (mode: merge) — upsert new aggregated move data ─────────────────────

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	// Verify ownership
	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

	if (!prep) throw error(404, 'Prep not found');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const mode = body.mode;
	if (mode !== 'fetch' && mode !== 'merge-start' && mode !== 'merge-batch') {
		throw error(400, 'mode must be "fetch", "merge-start", or "merge-batch"');
	}

	if (mode === 'fetch') {
		// Return PGNs — use time window if provided, otherwise watermark
		const timeWindow = body.timeWindow as string | undefined;
		const sinceFromWindow = timeWindowToSince(timeWindow);
		// Use time window if provided, 0 for "all time", or watermark as fallback
		const since = sinceFromWindow ?? (timeWindow === 'all' ? 0 : prep.lastFetchedAt.getTime() + 1);

		const sinceDate = new Date(since);
		const rawMax = typeof body.maxGames === 'number' ? body.maxGames : 500;
		const maxGames = Math.max(50, Math.min(5000, rawMax));

		try {
			let games;
			if (prep.platform === 'LICHESS') {
				// Fetch max+1 to detect if more games are available
				games = await fetchLichessGames(prep.platformUsername, {
					since,
					max: maxGames + 1,
					sort: 'dateDesc'
				});
			} else {
				games = await fetchChesscomGames(prep.platformUsername, {
					since: sinceDate,
					max: maxGames + 1
				});
			}

			const hasMore = games.length > maxGames;
			const trimmed = hasMore ? games.slice(0, maxGames) : games;
			const pgns = trimmed.map((g) => g.pgn);
			return json({ pgns, gameCount: pgns.length, hasMore });
		} catch (e) {
			if (e instanceof LichessApiError || e instanceof ChesscomApiError) {
				if (e.status === 429) {
					return json(
						{ pgns: [], gameCount: 0, hasMore: false, rateLimited: true },
						{ status: 429 }
					);
				}
				if (e.status === 404) {
					throw error(404, `User "${prep.platformUsername}" not found`);
				}
			}
			throw error(502, `Failed to fetch games: ${e instanceof Error ? e.message : String(e)}`);
		}
	} else if (mode === 'merge-start') {
		// Phase 1 of chunked merge: delete old data and update metadata.
		// The client then sends move data in merge-batch requests.
		const gamesAsWhite = typeof body.gamesAsWhite === 'number' ? body.gamesAsWhite : 0;
		const gamesAsBlack = typeof body.gamesAsBlack === 'number' ? body.gamesAsBlack : 0;

		const now = new Date();

		await db.transaction(async (tx) => {
			await tx.delete(opponentMoves).where(eq(opponentMoves.prepId, prepId));
			await tx
				.update(opponentPreps)
				.set({
					lastFetchedAt: now,
					gamesAsWhite: gamesAsWhite || 0,
					gamesAsBlack: gamesAsBlack || 0
				})
				.where(eq(opponentPreps.id, prepId));
		});

		return json({ started: true });
	} else if (mode === 'merge-batch') {
		// Phase 2 of chunked merge: insert a batch of moves (called repeatedly).
		const { moves } = body as { moves: AggregatedMove[] };

		if (!Array.isArray(moves) || moves.length === 0) {
			throw error(400, 'moves must be a non-empty array');
		}

		await db.insert(opponentMoves).values(
			moves.map((m) => ({
				prepId,
				positionFen: fenKey(m.positionFen),
				moveSan: m.moveSan,
				opponentColor: m.opponentColor,
				resultingFen: fenKey(m.resultingFen),
				gamesPlayed: m.gamesPlayed,
				whiteWins: m.whiteWins,
				blackWins: m.blackWins,
				draws: m.draws
			}))
		);

		return json({ inserted: moves.length });
	}

	// Unreachable — mode is validated above
	throw error(400, 'Invalid mode');
};
