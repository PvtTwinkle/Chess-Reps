// GET  /api/moves?repertoireId=X  — load all saved moves for a repertoire
// POST /api/moves                  — save a new move to the repertoire
//
// The POST handler is where the core build-mode logic lives:
//
//   User's turn (repertoire color matches FEN active side):
//     • Only one move is allowed per position.
//     • Saving also creates a user_repertoire_move SR card (so it gets drilled).
//     • Returns 409 if a DIFFERENT move already exists from this position.
//     • Returns 200 with the existing row if the exact same move already exists.
//
//   Opponent's turn:
//     • Multiple moves are allowed (all lines the user wants to prepare for).
//     • No SR card is created (you drill your own responses, not the opponent's moves).
//     • Returns 200 with the existing row if the exact same move already exists.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Chess } from 'chess.js';
import { db } from '$lib/db';
import { repertoire, userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// ── GET ────────────────────────────────────────────────────────────────────────

export const GET: RequestHandler = ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const repertoireIdParam = url.searchParams.get('repertoireId');
	if (!repertoireIdParam) throw error(400, 'repertoireId query parameter is required');

	const repertoireId = parseInt(repertoireIdParam);
	if (isNaN(repertoireId)) throw error(400, 'repertoireId must be a number');

	// Verify this repertoire belongs to the requesting user before returning data.
	const rep = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)))
		.get();

	if (!rep) throw error(404, 'Repertoire not found');

	const moves = db
		.select()
		.from(userMove)
		.where(and(eq(userMove.userId, locals.user.id), eq(userMove.repertoireId, repertoireId)))
		.all();

	return json(moves);
};

// ── POST ───────────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	// toFen is intentionally NOT read from the body — we compute it server-side
	// by applying the move to fromFen. Accepting it from the client would allow
	// a crafted request to store an arbitrary FEN as the destination position,
	// corrupting the move tree.
	const { repertoireId, fromFen, san } = body;

	// Input validation
	if (!repertoireId || typeof repertoireId !== 'number') {
		throw error(400, 'repertoireId is required and must be a number');
	}
	if (!fromFen || typeof fromFen !== 'string') throw error(400, 'fromFen is required');
	if (!san || typeof san !== 'string') throw error(400, 'san is required');

	// Verify the repertoire exists and belongs to this user.
	const rep = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)))
		.get();

	if (!rep) throw error(404, 'Repertoire not found');

	// Determine if it is the user's turn at this position, and compute toFen.
	// Chess.js parses the FEN and tells us whose turn it is ('w' or 'b').
	// We compare that against the repertoire's color to decide.
	// Applying chess.move(san) also validates that san is a legal move from
	// fromFen — if it isn't, Chess.js throws and we return 400.
	let isUserTurn: boolean;
	let toFen: string;
	try {
		const chess = new Chess(fromFen);
		const fenTurn = chess.turn(); // 'w' or 'b'
		isUserTurn =
			(rep.color === 'WHITE' && fenTurn === 'w') || (rep.color === 'BLACK' && fenTurn === 'b');
		// Apply the move to validate it and compute the resulting position.
		const result = chess.move(san);
		if (!result) throw new Error('Illegal move');
		toFen = chess.fen();
	} catch {
		throw error(400, 'Invalid FEN or move');
	}

	if (isUserTurn) {
		// User can have at most one move per position.
		// Check whether a move from this position already exists.
		const existing = db
			.select()
			.from(userMove)
			.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.fromFen, fromFen)))
			.get();

		if (existing) {
			if (existing.san === san) {
				// The exact same move is already saved — idempotent, return it.
				return json(existing);
			}
			// A different move already exists at this position — signal conflict.
			// The client uses this to show a warning and snap the board back.
			return json({ error: 'A move already exists from this position', existing }, { status: 409 });
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
			// Already exists — idempotent, return it.
			return json(existing);
		}
	}

	// Save the move.
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

	// Create a spaced repetition card for the user's own moves only.
	// The card starts in "New" state (state=0) and is immediately due,
	// meaning it will appear in the very next drill session.
	// Opponent moves are NOT drilled — you need to know your own responses,
	// not predict every move your opponent might make.
	if (isUserTurn) {
		db.insert(userRepertoireMove)
			.values({
				userId: locals.user.id,
				repertoireId,
				fromFen,
				san,
				due: new Date(), // immediately due
				state: 0, // 0 = New in the FSRS state machine
				reps: 0,
				lapses: 0,
				stability: null,
				difficulty: null,
				elapsedDays: null,
				scheduledDays: null,
				lastReview: null
			})
			.run();
	}

	return json(savedMove, { status: 201 });
};
