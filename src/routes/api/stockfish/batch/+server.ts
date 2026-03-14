// POST /api/stockfish/batch
//
// Evaluates an array of FEN positions sequentially and streams results back
// as NDJSON (newline-delimited JSON). Used by game review to compute
// centipawn loss for every move in the game.
//
// Each position is evaluated at a fixed depth (14) with MultiPV 1 — we only
// need the best move's score for CPL classification, not candidate lists.
// Positions are processed one at a time to avoid CPU contention.
//
// Response lines:
//   { "index": 0, "evalCp": 30, "evalMate": null }
//   { "index": 1, "evalCp": 25, "evalMate": null }
//   ...
//   { "done": true }

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTopMoves } from '$lib/stockfish';
import { Chess } from 'chess.js';

// Fixed depth for batch evaluation — lower than interactive analysis
// because we're classifying moves into 4 buckets, not providing precise evals.
const BATCH_DEPTH = 14;

// Per-position timeout. Shorter than interactive because we process many
// positions and don't want one stuck position to stall the whole batch.
const POSITION_TIMEOUT_MS = 5_000;

// Maximum positions per request (generous cap for very long games).
const MAX_FENS = 200;

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body: { fens?: string[] };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { fens } = body;
	if (!Array.isArray(fens) || fens.length === 0) {
		throw error(400, 'fens must be a non-empty array');
	}
	if (fens.length > MAX_FENS) {
		throw error(400, `Too many positions (max ${MAX_FENS})`);
	}
	if (fens.some((f) => typeof f !== 'string' || f.length > 100)) {
		throw error(400, 'Each FEN must be a string under 100 characters');
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			try {
				for (let i = 0; i < fens.length; i++) {
					// Stop if the client disconnected.
					if (request.signal.aborted) break;

					const fen = fens[i];
					let evalCp: number | null = null;
					let evalMate: number | null = null;

					try {
						// Determine which side is to move so we can flip the score
						// to always be from white's perspective.
						const chess = new Chess(fen);
						const whiteMultiplier = chess.turn() === 'w' ? 1 : -1;

						const moves = await getTopMoves(fen, BATCH_DEPTH, 1, POSITION_TIMEOUT_MS);
						if (moves.length > 0) {
							const best = moves[0];
							evalCp = best.scoreCp != null ? best.scoreCp * whiteMultiplier : null;
							evalMate = best.scoreMate != null ? best.scoreMate * whiteMultiplier : null;
						}
					} catch {
						// Position failed (invalid FEN, engine crash, etc.) — skip it.
					}

					const line = JSON.stringify({ index: i, evalCp, evalMate }) + '\n';
					controller.enqueue(encoder.encode(line));
				}

				// Signal completion.
				controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
				controller.close();
			} catch {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			'Cache-Control': 'no-cache',
			'X-Accel-Buffering': 'no'
		}
	});
};
