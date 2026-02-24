// POST /api/stockfish
//
// Given a board position (FEN), returns a ranked list of candidate moves
// drawn from two sources:
//
//   1. The shared book database — curated opening theory shipped with the app.
//   2. Stockfish engine analysis — computed best moves for positions beyond
//      or alongside the book.
//
// Book moves are listed first. Stockfish moves that the book doesn't cover
// follow after. All evaluation scores are normalised to WHITE's perspective
// (standard chess convention): positive = white is better, negative = black.
//
// If Stockfish is unreachable (e.g. running without Docker), the endpoint
// still returns book moves with null eval scores rather than failing.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTopMoves } from '$lib/stockfish';
import { db } from '$lib/db';
import { bookMove } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { Chess } from 'chess.js';

// How many Stockfish candidates to show when there are no book moves.
const DEFAULT_ENGINE_MOVES = 5;
// Search depth. Will eventually be driven by the user's settings page.
const DEFAULT_DEPTH = 15;

// Upper bounds to prevent a crafted request from pinning the engine.
// Depth 20 already takes several seconds; going higher is impractical.
// More than 5 candidates is overwhelming in the UI and wastes engine time.
const MAX_DEPTH = 20;
const MAX_CANDIDATES = 5;

// Shape of each candidate move returned to the browser.
export interface Candidate {
	san: string; // move in Standard Algebraic Notation, e.g. "e4", "Nf3"
	uci: string; // UCI notation, e.g. "e2e4" — used internally
	evalCp: number | null; // centipawns from white's perspective (null = engine unavailable)
	evalMate: number | null; // moves to mate from white's perspective (null = not a mating line)
	isBook: boolean; // true if this move appears in the shared opening book
	annotation: string | null; // curator note for book moves, e.g. "main line"
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as { fen?: string; depth?: number; numMoves?: number };
	const {
		fen,
		depth: rawDepth = DEFAULT_DEPTH,
		numMoves: rawNumMoves = DEFAULT_ENGINE_MOVES
	} = body;
	const depth = Math.min(rawDepth, MAX_DEPTH);
	const numMoves = Math.min(rawNumMoves, MAX_CANDIDATES);

	if (!fen || typeof fen !== 'string') {
		return json({ error: 'fen is required' }, { status: 400 });
	}

	// ── 1. Book lookup ────────────────────────────────────────────────────────
	// Find all known opening moves from this exact position.
	const bookMoves = db.select().from(bookMove).where(eq(bookMove.fromFen, fen)).all();

	// ── 2. Stockfish analysis ─────────────────────────────────────────────────
	// Request enough PVs to cover every book move plus the default engine count.
	// This ensures book moves can still be cross-referenced with engine scores
	// even if the engine would have ranked them outside the top DEFAULT_ENGINE_MOVES.
	const pvCount = Math.max(numMoves, bookMoves.length + DEFAULT_ENGINE_MOVES);
	const engineResults = await getTopMoves(fen, depth, pvCount);
	const engineAvailable = engineResults.length > 0;

	// Stockfish scores are from the side-to-move's perspective. Multiply by this
	// to convert them to white's perspective for display.
	const chess = new Chess(fen);
	const whiteMultiplier = chess.turn() === 'w' ? 1 : -1;

	// Quick lookup: UCI move string → engine result for that move.
	const uciToEngine = new Map(engineResults.map((r) => [r.uci, r]));

	// ── 3. Merge into a single candidate list ─────────────────────────────────
	const candidates: Candidate[] = [];
	const seenUci = new Set<string>();

	// Book moves first — annotated with engine score if the engine also found them.
	for (const bm of bookMoves) {
		// Convert SAN → UCI so we can cross-reference with engine results.
		// We use a temporary Chess instance so the main one stays at the original FEN.
		const tempChess = new Chess(fen);
		const result = tempChess.move(bm.san);
		if (!result) continue; // Skip if the book somehow contains an illegal move.

		const uci = result.from + result.to + (result.promotion ?? '');
		seenUci.add(uci);

		const eng = uciToEngine.get(uci);
		candidates.push({
			san: bm.san,
			uci,
			evalCp: eng?.scoreCp != null ? eng.scoreCp * whiteMultiplier : null,
			evalMate: eng?.scoreMate != null ? eng.scoreMate * whiteMultiplier : null,
			isBook: true,
			annotation: bm.annotation ?? null
		});
	}

	// Engine moves not covered by the book — pure Stockfish suggestions.
	for (const eng of engineResults) {
		if (seenUci.has(eng.uci)) continue;

		// Convert UCI → SAN using Chess.js.
		const tempChess = new Chess(fen);
		const result = tempChess.move({
			from: eng.uci.slice(0, 2),
			to: eng.uci.slice(2, 4),
			promotion: (eng.uci[4] as 'q' | 'r' | 'b' | 'n') || undefined
		});
		if (!result) continue;

		candidates.push({
			san: result.san,
			uci: eng.uci,
			evalCp: eng.scoreCp != null ? eng.scoreCp * whiteMultiplier : null,
			evalMate: eng.scoreMate != null ? eng.scoreMate * whiteMultiplier : null,
			isBook: false,
			annotation: null
		});
	}

	return json({ candidates, engineAvailable });
};
