// Gap Finder — shared logic for detecting uncovered positions.
//
// A "gap" is an opponent-turn position in the user's repertoire where
// a book move exists but the user has no prepared response to it.
// For example, if the user plays 1.e4 and the book has 1...c5, 1...e5,
// and 1...e6 as responses, but the user only has lines after 1...e5,
// then 1...c5 and 1...e6 are gaps.

import { fenKey, STARTING_FEN } from '$lib/fen';
export { fenKey, STARTING_FEN };

/** A single gap: a book/masters move the user hasn't prepared a response to. */
export interface Gap {
	fromFen: string; // opponent-turn position where the book move starts
	bookMoveSan: string; // the book move with no user response
	toFen: string; // position after that book move (user needs a move here)
	line: string; // comma-separated SAN list for ?line= deep link to Build Mode
	depth: number; // number of half-moves to reach toFen (for ranking)
	gamesPlayed?: number; // masters DB game count (undefined for book-only gaps)
}

/** Minimal move shape — works with userMove, bookMove, and chessmontMoves row types. */
interface MoveRow {
	fromFen: string;
	toFen: string;
	san: string;
	gamesPlayed?: number;
}

/**
 * Detects gaps in a user's repertoire by comparing their move tree against
 * the opening book.
 *
 * @param moves      All userMove rows for the repertoire
 * @param bookMoves  Book moves from opponent-turn positions in the repertoire
 * @param color      Which side the user plays ("WHITE" or "BLACK")
 * @param startFens  Optional start FENs — only positions reachable from these
 *                   are checked for gaps. Defaults to [STARTING_FEN].
 * @returns          Sorted array of Gap objects (shallowest first)
 */
export function computeGaps(
	moves: MoveRow[],
	bookMoves: MoveRow[],
	color: 'WHITE' | 'BLACK',
	startFens?: string[]
): Gap[] {
	if (moves.length === 0) return [];

	// Build the user-turn "covered" set — positions where the user has a move.
	// A position is covered if any userMove starts from it on the user's turn.
	const userTurnChar = color === 'WHITE' ? 'w' : 'b';
	const coveredKeys = new Set<string>();
	for (const m of moves) {
		const turn = m.fromFen.split(' ')[1];
		if (turn === userTurnChar) {
			coveredKeys.add(fenKey(m.fromFen));
		}
	}

	// BFS over user moves from the starting position to reconstruct the SAN
	// path to each position. This gives us the ?line= parameter for Build Mode.
	const adj = new Map<string, MoveRow[]>();
	for (const m of moves) {
		const key = fenKey(m.fromFen);
		let list = adj.get(key);
		if (!list) {
			list = [];
			adj.set(key, list);
		}
		list.push(m);
	}

	const rootKey = fenKey(STARTING_FEN);
	const pathMap = new Map<string, string[]>(); // fenKey → SAN path to reach it
	pathMap.set(rootKey, []);

	const queue: string[] = [rootKey];
	while (queue.length > 0) {
		const current = queue.shift()!;
		const children = adj.get(current);
		if (!children) continue;

		const currentPath = pathMap.get(current)!;
		for (const child of children) {
			const childKey = fenKey(child.toFen);
			if (pathMap.has(childKey)) continue; // already visited
			pathMap.set(childKey, [...currentPath, child.san]);
			queue.push(childKey);
		}
	}

	// Build the set of in-scope positions: only check gaps at positions
	// reachable from the effective start FEN(s).
	const effectiveStarts = startFens ?? [STARTING_FEN];
	const inScopeKeys = new Set<string>();
	const scopeQueue: string[] = [];

	for (const fen of effectiveStarts) {
		const key = fenKey(fen);
		if (!inScopeKeys.has(key)) {
			inScopeKeys.add(key);
			scopeQueue.push(key);
		}
	}

	while (scopeQueue.length > 0) {
		const current = scopeQueue.shift()!;
		const children = adj.get(current);
		if (!children) continue;

		for (const child of children) {
			const childKey = fenKey(child.toFen);
			if (inScopeKeys.has(childKey)) continue;
			inScopeKeys.add(childKey);
			scopeQueue.push(childKey);
		}
	}

	// Find gaps: book moves whose destination is not covered by any user move.
	// Only consider book moves from in-scope positions.
	// Deduplicate by toFen key to avoid counting the same uncovered position
	// multiple times (e.g. reached via transposition).
	const seen = new Set<string>();
	const gaps: Gap[] = [];

	for (const bm of bookMoves) {
		const fromKey = fenKey(bm.fromFen);
		if (!inScopeKeys.has(fromKey)) continue; // outside repertoire scope

		const toKey = fenKey(bm.toFen);
		if (coveredKeys.has(toKey)) continue; // user has a response here
		if (seen.has(toKey)) continue; // already recorded this gap
		seen.add(toKey);

		const pathToFrom = pathMap.get(fromKey);
		if (!pathToFrom) continue; // unreachable from starting position (shouldn't happen)

		const line = [...pathToFrom, bm.san].join(',');
		gaps.push({
			fromFen: bm.fromFen,
			bookMoveSan: bm.san,
			toFen: bm.toFen,
			line,
			depth: pathToFrom.length + 1,
			gamesPlayed: bm.gamesPlayed
		});
	}

	// Sort masters gaps first (by games played descending), then book-only gaps by depth.
	gaps.sort((a, b) => {
		if (a.gamesPlayed && b.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
		if (a.gamesPlayed) return -1;
		if (b.gamesPlayed) return 1;
		return a.depth - b.depth;
	});

	return gaps;
}

/**
 * Formats a comma-separated SAN list into a human-readable move sequence.
 * Example: "e4,c5,Nf3" → "1. e4 c5 2. Nf3"
 */
export function formatLine(line: string): string {
	const sans = line.split(',');
	return sans.map((san, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${san}` : san)).join(' ');
}
