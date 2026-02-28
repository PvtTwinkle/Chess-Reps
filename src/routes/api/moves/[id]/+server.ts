// DELETE /api/moves/[id] — remove a move and its entire downstream subtree.
//
// Opening repertoires are trees. If you delete a move mid-tree, you leave
// orphaned branches behind (positions with no reachable path from the start).
// To keep the tree clean, this endpoint deletes the target move AND every move
// that is only reachable through it.
//
// Example tree:
//   Start → e4 → e5 → Nf3 → Nc6
//                    → d4         ← a second branch
//
// Deleting "e5" deletes the entire subtree: Nf3, Nc6, and d4.
// Deleting "Nf3" only deletes Nf3 and Nc6 — the "e4 → e5 → d4" branch survives.
//
// This also cleans up the corresponding user_repertoire_move (SR card) rows,
// so deleted moves do not keep appearing in drill sessions.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Recursively deletes all moves reachable from startFen in the given repertoire.
// Depth-first: removes the deepest branches before their parents.
// Returns the number of move rows deleted.
function deleteSubtree(userId: number, repertoireId: number, startFen: string): number {
	let count = 0;

	// Find every move that starts from this position.
	const children = db
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.fromFen, startFen)))
		.all();

	for (const child of children) {
		// Recurse into the child's subtree before deleting the child itself.
		count += deleteSubtree(userId, repertoireId, child.toFen);

		// Delete the SR card for this move if one exists.
		// (Only user-turn moves have SR cards, but a no-op delete is harmless.)
		db.delete(userRepertoireMove)
			.where(
				and(
					eq(userRepertoireMove.userId, userId),
					eq(userRepertoireMove.repertoireId, repertoireId),
					eq(userRepertoireMove.fromFen, startFen),
					eq(userRepertoireMove.san, child.san)
				)
			)
			.run();

		// Delete the move row itself.
		db.delete(userMove).where(eq(userMove.id, child.id)).run();
		count++;
	}

	return count;
}

export const DELETE: RequestHandler = ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'Invalid move ID');

	// Fetch the move — must exist and belong to this user.
	const move = db
		.select()
		.from(userMove)
		.where(and(eq(userMove.id, id), eq(userMove.userId, locals.user.id)))
		.get();

	if (!move) throw error(404, 'Move not found');

	// Delete all moves reachable from this move's destination position.
	const subtreeCount = deleteSubtree(locals.user.id, move.repertoireId, move.toFen);

	// Delete the SR card for the move being deleted.
	db.delete(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, locals.user.id),
				eq(userRepertoireMove.repertoireId, move.repertoireId),
				eq(userRepertoireMove.fromFen, move.fromFen),
				eq(userRepertoireMove.san, move.san)
			)
		)
		.run();

	// Delete the move itself.
	db.delete(userMove).where(eq(userMove.id, id)).run();

	// Defense-in-depth: sweep for orphaned SR cards in this repertoire.
	// An SR card is orphaned if no userMove exists with the same
	// (repertoireId, fromFen, san). This catches edge cases like FEN
	// normalization mismatches from PGN transpositions.
	const allCards = db
		.select({
			id: userRepertoireMove.id,
			fromFen: userRepertoireMove.fromFen,
			san: userRepertoireMove.san
		})
		.from(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, locals.user.id),
				eq(userRepertoireMove.repertoireId, move.repertoireId)
			)
		)
		.all();

	for (const card of allCards) {
		const matchingMove = db
			.select({ id: userMove.id })
			.from(userMove)
			.where(
				and(
					eq(userMove.repertoireId, move.repertoireId),
					eq(userMove.fromFen, card.fromFen),
					eq(userMove.san, card.san)
				)
			)
			.get();

		if (!matchingMove) {
			db.delete(userRepertoireMove).where(eq(userRepertoireMove.id, card.id)).run();
		}
	}

	return json({ deleted: subtreeCount + 1 });
};

// ── PATCH ──────────────────────────────────────────────────────────────────────
// Updates the notes annotation on a single move.
// Expects JSON body: { notes: string | null }
// An empty string is coerced to null — we do not store empty annotations.

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'Invalid move ID');

	// Ownership check — one query, fails for wrong user or missing row.
	const move = db
		.select()
		.from(userMove)
		.where(and(eq(userMove.id, id), eq(userMove.userId, locals.user.id)))
		.get();

	if (!move) throw error(404, 'Move not found');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	let { notes } = body;

	if (notes !== null && typeof notes !== 'string') {
		throw error(400, 'notes must be a string or null');
	}
	if (typeof notes === 'string') {
		notes = notes.trim();
		if (notes.length === 0) notes = null;
		if (notes !== null && notes.length > 500) {
			throw error(400, 'notes must be 500 characters or fewer');
		}
	}

	const updated = db.update(userMove).set({ notes }).where(eq(userMove.id, id)).returning().get();

	return json(updated);
};
