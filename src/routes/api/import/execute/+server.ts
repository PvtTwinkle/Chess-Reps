// POST /api/import/execute
//
// Batch-insert PGN-imported moves into the user's repertoire.
// All writes happen in a single transaction for atomicity.
//
// Input: {
//   repertoireId: number,
//   moves: { fromFen: string, san: string }[],          // all moves to import
//   replacements: { fromFen: string, san: string }[]     // conflicts resolved by user
// }
//
// Output: { inserted: number, replaced: number, skipped: number }
//
// Security: toFen is computed server-side for every move (never from client).
// Mirrors the pattern in POST /api/moves and POST /api/review/add-move.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Chess } from 'chess.js';
import { db } from '$lib/db';
import { repertoire, userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey } from '$lib/pgn/index';

interface MoveInput {
	fromFen: string;
	san: string;
	annotation?: string | null;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	const user = locals.user;

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const {
		repertoireId,
		moves,
		replacements = []
	} = body as {
		repertoireId: number;
		moves: MoveInput[];
		replacements: MoveInput[];
	};

	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId must be a number');
	if (!Array.isArray(moves) || moves.length === 0) throw error(400, 'moves array is required');
	if (!Array.isArray(replacements)) throw error(400, 'replacements must be an array');

	// Verify repertoire ownership
	const rep = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)))
		.get();
	if (!rep) throw error(404, 'Repertoire not found');

	const repColor = rep.color as 'WHITE' | 'BLACK';

	// Build a set of replacement fenKeys for quick lookup
	const replacementSet = new Set<string>();
	for (const r of replacements) {
		replacementSet.add(fenKey(r.fromFen) + '|' + r.san);
	}

	// Validate all moves upfront and compute toFen for each
	const validatedMoves: {
		fromFen: string;
		toFen: string;
		san: string;
		isUserTurn: boolean;
		notes: string | null;
	}[] = [];

	for (const m of moves) {
		if (!m.fromFen || typeof m.fromFen !== 'string') continue;
		if (!m.san || typeof m.san !== 'string') continue;

		try {
			const chess = new Chess(m.fromFen);
			const fenTurn = chess.turn();
			const isUserTurn =
				(repColor === 'WHITE' && fenTurn === 'w') || (repColor === 'BLACK' && fenTurn === 'b');

			const result = chess.move(m.san);
			if (!result) continue;

			// Truncate annotation to 500 chars (matches existing notes limit)
			const raw = m.annotation;
			const notes = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 500) : null;

			validatedMoves.push({
				fromFen: m.fromFen,
				toFen: chess.fen(),
				san: result.san, // normalized SAN from Chess.js
				isUserTurn,
				notes
			});
		} catch {
			// Skip invalid moves silently — they were already flagged during parse
			continue;
		}
	}

	if (validatedMoves.length === 0) {
		throw error(400, 'No valid moves to import');
	}

	// Single transaction for all writes
	const result = db.transaction((tx) => {
		let inserted = 0;
		let replaced = 0;
		let skipped = 0;

		for (const vm of validatedMoves) {
			if (vm.isUserTurn) {
				// Check for existing move at this position
				const existing = tx
					.select()
					.from(userMove)
					.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.fromFen, vm.fromFen)))
					.get();

				if (existing) {
					if (existing.san === vm.san) {
						// Exact same move — skip (idempotent)
						skipped++;
						continue;
					}

					// Different move exists — check if user chose to replace it
					const replaceKey = fenKey(vm.fromFen) + '|' + vm.san;
					if (replacementSet.has(replaceKey)) {
						// User chose this PGN move over the existing one — replace
						tx.update(userMove)
							.set({
								san: vm.san,
								toFen: vm.toFen,
								source: 'PGN_IMPORT',
								...(vm.notes != null ? { notes: vm.notes } : {})
							})
							.where(eq(userMove.id, existing.id))
							.run();

						// Update the SR card's SAN to match
						tx.update(userRepertoireMove)
							.set({ san: vm.san })
							.where(
								and(
									eq(userRepertoireMove.userId, user.id),
									eq(userRepertoireMove.repertoireId, repertoireId),
									eq(userRepertoireMove.fromFen, vm.fromFen)
								)
							)
							.run();

						replaced++;
					} else {
						// Not in replacements — keep existing (safety default)
						skipped++;
					}
					continue;
				}

				// No existing move — insert new move + SR card
				tx.insert(userMove)
					.values({
						userId: user.id,
						repertoireId,
						fromFen: vm.fromFen,
						toFen: vm.toFen,
						san: vm.san,
						source: 'PGN_IMPORT',
						notes: vm.notes,
						createdAt: new Date()
					})
					.run();

				tx.insert(userRepertoireMove)
					.values({
						userId: user.id,
						repertoireId,
						fromFen: vm.fromFen,
						san: vm.san,
						due: new Date(),
						state: 0, // New
						reps: 0,
						lapses: 0,
						stability: null,
						difficulty: null,
						elapsedDays: null,
						scheduledDays: null,
						lastReview: null,
						learningSteps: 0
					})
					.run();

				inserted++;
			} else {
				// Opponent's turn — multiple moves allowed, no SR card
				const existing = tx
					.select()
					.from(userMove)
					.where(
						and(
							eq(userMove.repertoireId, repertoireId),
							eq(userMove.fromFen, vm.fromFen),
							eq(userMove.san, vm.san)
						)
					)
					.get();

				if (existing) {
					skipped++;
					continue;
				}

				tx.insert(userMove)
					.values({
						userId: user.id,
						repertoireId,
						fromFen: vm.fromFen,
						toFen: vm.toFen,
						san: vm.san,
						source: 'PGN_IMPORT',
						notes: vm.notes,
						createdAt: new Date()
					})
					.run();

				inserted++;
			}
		}

		return { inserted, replaced, skipped };
	});

	return json(result);
};
