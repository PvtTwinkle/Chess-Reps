// GET /api/stockfish/stream?fen=<fen>
//
// Server-Sent Events endpoint that streams Stockfish analysis results as
// they arrive at each search depth. Each SSE event contains the current
// best candidates with their evaluations (always from white's perspective).
//
// The client receives progressive updates — a quick initial eval at low
// depth that refines over several seconds until the configured depth or
// timeout is reached.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { streamTopMoves } from '$lib/stockfish';
import { db } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { Chess } from 'chess.js';

const DEFAULT_ENGINE_MOVES = 3;
const DEFAULT_DEPTH = 20;
const MIN_DEPTH = 15;
const MAX_DEPTH = 30;
const MAX_CANDIDATES = 5;

export const GET: RequestHandler = async ({ url, locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const fen = url.searchParams.get('fen');
	if (!fen || fen.length > 100) throw error(400, 'fen is required');

	const rawNumMoves = parseInt(url.searchParams.get('numMoves') ?? '', 10) || DEFAULT_ENGINE_MOVES;
	const numMoves = Math.min(rawNumMoves, MAX_CANDIDATES);

	// Load user settings for depth and timeout.
	const [settings] = await db
		.select({
			stockfishDepth: userSettings.stockfishDepth,
			stockfishTimeout: userSettings.stockfishTimeout
		})
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));

	const rawDepth = settings?.stockfishDepth ?? DEFAULT_DEPTH;
	const depth = Math.max(MIN_DEPTH, Math.min(rawDepth, MAX_DEPTH));
	const timeoutSec = settings?.stockfishTimeout ?? 10;

	// Stockfish scores are from the side-to-move's perspective. Multiply
	// by this to convert to white's perspective for the UI.
	const chess = new Chess(fen);
	const whiteMultiplier = chess.turn() === 'w' ? 1 : -1;

	const generator = streamTopMoves(fen, depth, numMoves, timeoutSec * 1000);

	// Kill the Stockfish process if the client disconnects.
	request.signal.addEventListener('abort', () => {
		generator.return({ depth: 0, moves: [], done: true });
	});

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			try {
				for await (const update of generator) {
					// Convert each UCI move to SAN and flip scores to white's perspective.
					const candidates = [];
					for (const move of update.moves) {
						const tempChess = new Chess(fen);
						const result = tempChess.move({
							from: move.uci.slice(0, 2),
							to: move.uci.slice(2, 4),
							promotion: (move.uci[4] as 'q' | 'r' | 'b' | 'n') || undefined
						});
						if (!result) continue;

						candidates.push({
							san: result.san,
							uci: move.uci,
							evalCp: move.scoreCp != null ? move.scoreCp * whiteMultiplier : null,
							evalMate: move.scoreMate != null ? move.scoreMate * whiteMultiplier : null
						});
					}

					const event = JSON.stringify({
						depth: update.depth,
						maxDepth: depth,
						candidates,
						done: update.done
					});

					controller.enqueue(encoder.encode(`data: ${event}\n\n`));

					if (update.done) {
						controller.close();
						return;
					}
				}
				// Generator exhausted without a done=true (shouldn't happen, but be safe).
				controller.close();
			} catch {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
