// POST   /api/prep/:id/moves — add a user's prep response move
// DELETE /api/prep/:id/moves — remove a prep move by ID
//
// Prep moves are sandboxed — they live in prep_moves, completely separate
// from the user's real repertoire moves. No SR cards are created.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Chess } from 'chess.js';
import { db } from '$lib/db';
import { opponentPreps, prepMoves } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey, sanitizeFen } from '$lib/fen';

// ── POST ─────────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { san, color } = body;
	if (!san || typeof san !== 'string') throw error(400, 'san is required');
	if (color !== 'white' && color !== 'black') throw error(400, 'color must be white or black');

	const sanitized = sanitizeFen(body.fromFen);
	if (!sanitized) throw error(400, 'Invalid FEN');
	const fromFen = fenKey(sanitized);

	// Verify prep ownership
	const [prep] = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

	if (!prep) throw error(404, 'Prep not found');

	// Compute toFen server-side (never trust client)
	let toFen: string;
	try {
		const chess = new Chess(fromFen);
		const result = chess.move(san);
		if (!result) throw new Error('Illegal move');
		toFen = fenKey(chess.fen());
	} catch {
		throw error(400, 'Invalid FEN or move');
	}

	// Determine if this is the user's turn — only one move per position allowed
	try {
		const chess = new Chess(fromFen);
		const fenTurn = chess.turn();
		const isUserTurn =
			(color === 'white' && fenTurn === 'w') || (color === 'black' && fenTurn === 'b');

		if (isUserTurn) {
			// Check if ANY move already exists at this position for this color
			const [existingAtPosition] = await db
				.select()
				.from(prepMoves)
				.where(
					and(
						eq(prepMoves.prepId, prepId),
						eq(prepMoves.fromFen, fromFen),
						eq(prepMoves.color, color)
					)
				);

			if (existingAtPosition) {
				if (existingAtPosition.san === san) {
					// Exact same move — idempotent, return it
					return json(existingAtPosition);
				}
				// Different move — conflict, signal 409
				return json(
					{ error: 'A prep move already exists from this position', existing: existingAtPosition },
					{ status: 409 }
				);
			}
		}
	} catch {
		// If FEN is invalid for Chess.js, fall through to the insert
	}

	// Check-and-insert in a transaction to prevent duplicate race conditions
	const result = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(prepMoves)
			.where(
				and(
					eq(prepMoves.prepId, prepId),
					eq(prepMoves.fromFen, fromFen),
					eq(prepMoves.san, san),
					eq(prepMoves.color, color)
				)
			);

		if (existing) return { move: existing, created: false };

		const [saved] = await tx
			.insert(prepMoves)
			.values({
				prepId,
				userId: locals.user!.id,
				fromFen,
				toFen,
				san,
				color,
				createdAt: new Date()
			})
			.returning();

		return { move: saved, created: true };
	});

	return json(result.move, { status: result.created ? 201 : 200 });
};

// ── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { moveId } = body;
	if (!moveId || typeof moveId !== 'number') throw error(400, 'moveId is required');

	// Verify the move belongs to this user
	const [move] = await db
		.select()
		.from(prepMoves)
		.where(and(eq(prepMoves.id, moveId), eq(prepMoves.userId, locals.user.id)));

	if (!move) throw error(404, 'Prep move not found');

	await db.delete(prepMoves).where(eq(prepMoves.id, moveId));

	return json({ deleted: true });
};
