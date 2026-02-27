// POST /api/review/add-move
//
// Add a move to the user's repertoire from the game review page.
// Called for:
//   Case 2 (BEYOND_REPERTOIRE): user wants to add the move they played, or the
//     engine's suggestion, at a position they haven't mapped yet.
//   Case 3 (OPPONENT_SURPRISE): user wants to add the opponent's surprise move
//     and/or their own response to it.
//
// The optional `forceReplace` flag handles Case 1 (DEVIATION): when true, if a
// *different* move already exists from this position, update it rather than
// returning a 409 conflict. The FSRS card's SAN is updated accordingly.
//
// Core logic mirrors POST /api/moves to keep behaviour consistent.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Chess } from 'chess.js';
import { db } from '$lib/db';
import { repertoire, userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { repertoireId, fromFen, san, forceReplace = false } = body;

	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId must be a number');
	if (!fromFen || typeof fromFen !== 'string') throw error(400, 'fromFen is required');
	if (!san || typeof san !== 'string') throw error(400, 'san is required');

	// Verify the repertoire belongs to this user.
	const rep = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)))
		.get();
	if (!rep) throw error(404, 'Repertoire not found');

	// Compute toFen server-side (never accepted from the client — prevents crafted
	// requests from corrupting the move tree with arbitrary FENs).
	let isUserTurn: boolean;
	let toFen: string;
	try {
		const chess = new Chess(fromFen);
		const fenTurn = chess.turn(); // 'w' or 'b'
		isUserTurn =
			(rep.color === 'WHITE' && fenTurn === 'w') || (rep.color === 'BLACK' && fenTurn === 'b');
		const result = chess.move(san);
		if (!result) throw new Error('Illegal move');
		toFen = chess.fen();
	} catch {
		throw error(400, 'Invalid FEN or illegal move');
	}

	if (isUserTurn) {
		const existing = db
			.select()
			.from(userMove)
			.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.fromFen, fromFen)))
			.get();

		if (existing) {
			if (existing.san === san) {
				// Exact same move already exists — idempotent.
				return json(existing);
			}

			if (!forceReplace) {
				// Different move exists and we're not replacing — signal conflict.
				return json(
					{ error: 'A different move already exists from this position', existing },
					{ status: 409 }
				);
			}

			// forceReplace: update the existing move to the new san and toFen.
			// The old toFen's subtree is orphaned but not deleted — the user can
			// clean it up in Build mode if needed.
			db.update(userMove)
				.set({ san, toFen, source: 'PERSONAL' })
				.where(eq(userMove.id, existing.id))
				.run();

			// Update the SR card's SAN to match the new move.
			db.update(userRepertoireMove)
				.set({ san })
				.where(
					and(
						eq(userRepertoireMove.userId, locals.user.id),
						eq(userRepertoireMove.repertoireId, repertoireId),
						eq(userRepertoireMove.fromFen, fromFen)
					)
				)
				.run();

			const updated = db.select().from(userMove).where(eq(userMove.id, existing.id)).get()!;
			return json(updated);
		}
	} else {
		// Opponent's turn — multiple moves allowed, but no exact duplicates.
		const existing = db
			.select()
			.from(userMove)
			.where(
				and(
					eq(userMove.repertoireId, repertoireId),
					eq(userMove.fromFen, fromFen),
					eq(userMove.san, san)
				)
			)
			.get();

		if (existing) {
			return json(existing);
		}
	}

	// Insert the new move.
	const savedMove = db
		.insert(userMove)
		.values({
			userId: locals.user.id,
			repertoireId,
			fromFen,
			toFen,
			san,
			source: 'PERSONAL',
			notes: null,
			createdAt: new Date()
		})
		.returning()
		.get();

	// Create a spaced repetition card for user's own moves only.
	// Opponent moves are not drilled.
	if (isUserTurn) {
		db.insert(userRepertoireMove)
			.values({
				userId: locals.user.id,
				repertoireId,
				fromFen,
				san,
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
	}

	return json(savedMove, { status: 201 });
};
