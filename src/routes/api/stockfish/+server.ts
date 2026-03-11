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
import { bookMove, ecoOpening, userSettings } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { Chess } from 'chess.js';
import { fenKey } from '$lib/fen';

// How many engine candidates to return.
const DEFAULT_ENGINE_MOVES = 3;
// Fallback search depth when the user has no settings row.
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
	if (!locals.user) throw error(401, 'Not authenticated');

	let body: { fen?: string; depth?: number; numMoves?: number; mode?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { fen, numMoves: rawNumMoves = DEFAULT_ENGINE_MOVES } = body;

	// mode controls which sources to query:
	//   'book'   — only book moves (instant, no Stockfish call)
	//   'engine' — only engine moves (no book_move query)
	//   'both'   — current behavior (default, backwards compatible)
	const mode = body.mode ?? 'both';

	// Load the user's stored preferences for depth and timeout.
	const [settings] = await db
		.select({
			stockfishDepth: userSettings.stockfishDepth,
			stockfishTimeout: userSettings.stockfishTimeout
		})
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));

	// Depth: use the request value if provided, otherwise the user's preference.
	const rawDepth = body.depth ?? settings?.stockfishDepth ?? DEFAULT_DEPTH;
	const depth = Math.max(MIN_DEPTH, Math.min(rawDepth, MAX_DEPTH));
	const numMoves = Math.min(rawNumMoves, MAX_CANDIDATES);

	// Timeout in seconds from the user's settings (default 10s).
	const timeoutSec = settings?.stockfishTimeout ?? 10;

	if (!fen || typeof fen !== 'string') throw error(400, 'fen is required');
	if (fen.length > 100) throw error(400, 'fen is too long');

	// Normalize to 4-field FEN for DB lookups (book and eco tables store 4-field).
	const fenNorm = fenKey(fen);

	// ── 1. Book lookup ────────────────────────────────────────────────────────
	// Find all known opening moves from this exact position.
	// Skipped when mode is 'engine' (caller only wants Stockfish results).
	const bookMoves =
		mode !== 'engine' ? await db.select().from(bookMove).where(eq(bookMove.fromFen, fenNorm)) : [];

	// ── 2. Stockfish analysis ─────────────────────────────────────────────────
	// Request exactly numMoves PVs — the engine section is independent of the
	// book section, so we only need the top N engine candidates.
	// Skipped when mode is 'book' (caller only wants opening book results).
	const engineResults =
		mode !== 'book' ? await getTopMoves(fen, depth, numMoves, timeoutSec * 1000) : [];
	const engineAvailable = mode !== 'book' ? engineResults.length > 0 : false;

	// Stockfish scores are from the side-to-move's perspective. Multiply by this
	// to convert them to white's perspective for display.
	const chess = new Chess(fen);
	const whiteMultiplier = chess.turn() === 'w' ? 1 : -1;

	// ── 3. Look up ECO opening names for positions reached by book moves ──────
	// Each book move has a toFen — the position after the move is played. We batch
	// query eco_opening to find a name for each resulting position in one round-trip.
	// Skipped when there are no book moves (engine-only mode or no book data).
	const toFens = bookMoves.map((bm) => bm.toFen).filter(Boolean) as string[];
	const openingRows =
		toFens.length > 0
			? await db.select().from(ecoOpening).where(inArray(ecoOpening.fen, toFens))
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
