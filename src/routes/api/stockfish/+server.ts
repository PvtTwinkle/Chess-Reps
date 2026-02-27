// POST /api/stockfish
//
// Given a board position (FEN), returns candidate moves from two independent
// sources — returned as a flat array and split by `isBook` on the client:
//
//   1. Book moves — all moves from the shared opening book for this position.
//      These are never annotated with engine evaluations; the book is the
//      authoritative source for opening theory and evals would be misleading.
//
//   2. Engine moves — the top N Stockfish recommendations, always returned
//      regardless of whether they overlap with book moves. Engine evals are
//      always shown from white's perspective.
//
// If Stockfish is unreachable (e.g. running without Docker), the endpoint
// still returns book moves and an empty engine list rather than failing.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTopMoves } from '$lib/stockfish';
import { db } from '$lib/db';
import { bookMove, ecoOpening } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { Chess } from 'chess.js';

// How many engine candidates to return. Will eventually be driven by settings.
const DEFAULT_ENGINE_MOVES = 3;
// Search depth. Will eventually be driven by the user's settings page.
const DEFAULT_DEPTH = 20;

// Depth range enforced on every request. MIN prevents trivially shallow
// analysis; MAX is the user-configurable ceiling (going higher wastes engine time).
const MIN_DEPTH = 15;
const MAX_DEPTH = 30;
const MAX_CANDIDATES = 5;

// Shape of each candidate move returned to the browser.
export interface Candidate {
	san: string; // move in Standard Algebraic Notation, e.g. "e4", "Nf3"
	uci: string; // UCI notation, e.g. "e2e4" — used internally
	evalCp: number | null; // centipawns from white's perspective (null = engine unavailable)
	evalMate: number | null; // moves to mate from white's perspective (null = not a mating line)
	isBook: boolean; // true if this move appears in the shared opening book
	annotation: string | null; // curator note for book moves, e.g. "main line"
	openingName: string | null; // ECO opening name for the position this move leads to
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { fen?: string; depth?: number; numMoves?: number };
	try {
		body = (await request.json()) as { fen?: string; depth?: number; numMoves?: number };
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const {
		fen,
		depth: rawDepth = DEFAULT_DEPTH,
		numMoves: rawNumMoves = DEFAULT_ENGINE_MOVES
	} = body;
	const depth = Math.max(MIN_DEPTH, Math.min(rawDepth, MAX_DEPTH));
	const numMoves = Math.min(rawNumMoves, MAX_CANDIDATES);

	if (!fen || typeof fen !== 'string') {
		return json({ error: 'fen is required' }, { status: 400 });
	}

	// ── 1. Book lookup ────────────────────────────────────────────────────────
	// Find all known opening moves from this exact position.
	const bookMoves = db.select().from(bookMove).where(eq(bookMove.fromFen, fen)).all();

	// ── 2. Stockfish analysis ─────────────────────────────────────────────────
	// Request exactly numMoves PVs — the engine section is independent of the
	// book section, so we only need the top N engine candidates.
	const engineResults = await getTopMoves(fen, depth, numMoves);
	const engineAvailable = engineResults.length > 0;

	// Stockfish scores are from the side-to-move's perspective. Multiply by this
	// to convert them to white's perspective for display.
	const chess = new Chess(fen);
	const whiteMultiplier = chess.turn() === 'w' ? 1 : -1;

	// ── 3. Look up ECO opening names for positions reached by book moves ──────
	// Each book move has a toFen — the position after the move is played. We batch
	// query eco_opening to find a name for each resulting position in one round-trip.
	const toFens = bookMoves.map((bm) => bm.toFen).filter(Boolean) as string[];
	const openingRows =
		toFens.length > 0
			? db.select().from(ecoOpening).where(inArray(ecoOpening.fen, toFens)).all()
			: [];
	const fenToOpeningName = new Map(openingRows.map((r) => [r.fen, r.name]));

	// ── 4. Build the two independent candidate lists ───────────────────────────
	const candidates: Candidate[] = [];

	// Book moves — no engine eval. The book is the authoritative source for
	// opening theory; cross-referencing with engine scores would be misleading
	// (engine evals in opening positions are rarely meaningful).
	for (const bm of bookMoves) {
		// Convert SAN → UCI to compute the from/to squares for the UCI field.
		const tempChess = new Chess(fen);
		const result = tempChess.move(bm.san);
		if (!result) continue; // Skip if the book somehow contains an illegal move.

		const uci = result.from + result.to + (result.promotion ?? '');
		candidates.push({
			san: bm.san,
			uci,
			evalCp: null,
			evalMate: null,
			isBook: true,
			annotation: bm.annotation ?? null,
			openingName: bm.toFen ? (fenToOpeningName.get(bm.toFen) ?? null) : null
		});
	}

	// Engine moves — always the top N from Stockfish, regardless of whether they
	// also appear in the book. The two sections are independent tabs in the UI.
	for (const eng of engineResults) {
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
			annotation: null,
			openingName: null
		});
	}

	// Engine results come back ranked by Stockfish (PV1, PV2, …); book moves
	// are returned in DB insertion order. No further sorting is needed since
	// the two groups are displayed in separate tabs.

	return json({ candidates, engineAvailable });
};
