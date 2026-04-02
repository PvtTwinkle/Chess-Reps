// POST /api/train/evaluate
//
// Evaluates the final position of a training game with Stockfish, optionally
// updates the user's trainer rating, and saves the session to trainer_session.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userSettings, trainerSession } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getTopMoves } from '$lib/stockfish';
import { evalToScore, computeRatingChange, bracketMidpoint } from '$lib/trainer';
import type { TrainerEvalResult } from '$lib/trainer';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body: {
		fen?: string;
		rated?: boolean;
		repertoireId?: number;
		pgn?: string;
		movesPlayed?: number;
		startFen?: string;
		moveSource?: string;
		playerColor?: string;
		ratingBracket?: number | null;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const {
		fen,
		rated,
		repertoireId,
		pgn,
		movesPlayed,
		startFen,
		moveSource,
		playerColor,
		ratingBracket
	} = body;

	if (!fen || typeof fen !== 'string') throw error(400, 'fen is required');
	if (fen.length > 100) throw error(400, 'fen is too long');
	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId is required');
	if (typeof pgn !== 'string' || pgn.length === 0) throw error(400, 'pgn is required');
	if (typeof movesPlayed !== 'number') throw error(400, 'movesPlayed is required');
	if (typeof startFen !== 'string') throw error(400, 'startFen is required');
	if (moveSource !== 'PLAYERS' && moveSource !== 'MASTERS')
		throw error(400, 'moveSource must be PLAYERS or MASTERS');
	if (playerColor !== 'WHITE' && playerColor !== 'BLACK')
		throw error(400, 'playerColor must be WHITE or BLACK');

	const userId = locals.user.id;
	const isRated = rated === true;

	// Load user's Stockfish settings and current trainer rating
	const [settings] = await db
		.select({
			stockfishDepth: userSettings.stockfishDepth,
			stockfishTimeout: userSettings.stockfishTimeout,
			trainerRating: userSettings.trainerRating
		})
		.from(userSettings)
		.where(eq(userSettings.userId, userId));

	const depth = settings?.stockfishDepth ?? 15;
	const timeoutSec = settings?.stockfishTimeout ?? 10;
	const currentRating = settings?.trainerRating ?? 1200;

	// Run Stockfish evaluation (only need 1 PV for the eval score)
	const engineResults = await getTopMoves(fen, depth, 1, timeoutSec * 1000);

	const result: TrainerEvalResult = {
		evalCp: null,
		score: null,
		ratingBefore: null,
		ratingAfter: null,
		ratingChange: null
	};

	if (engineResults.length > 0) {
		const eng = engineResults[0];

		// Convert score from side-to-move's perspective to white's perspective
		const sideToMove = fen.split(' ')[1];
		const whiteMultiplier = sideToMove === 'w' ? 1 : -1;

		if (eng.scoreMate != null) {
			// Mate score: positive = side-to-move is delivering mate
			const mateFromWhite = eng.scoreMate * whiteMultiplier;
			result.evalCp = mateFromWhite > 0 ? Infinity : -Infinity;
		} else if (eng.scoreCp != null) {
			result.evalCp = eng.scoreCp * whiteMultiplier;
		}

		if (result.evalCp != null) {
			result.score = evalToScore(result.evalCp, playerColor);

			if (isRated && settings) {
				// Use bracket midpoint as opponent rating for Elo calculation.
				// Masters mode uses null bracket (midpoint defaults to 2500).
				const opponentMid = bracketMidpoint(ratingBracket ?? null);
				const ratingChange = computeRatingChange(result.score, opponentMid, currentRating);
				result.ratingBefore = currentRating;
				result.ratingAfter = Math.max(100, currentRating + ratingChange);
				result.ratingChange = result.ratingAfter - result.ratingBefore;

				// Update the user's trainer rating
				await db
					.update(userSettings)
					.set({ trainerRating: result.ratingAfter, updatedAt: new Date() })
					.where(eq(userSettings.userId, userId));
			}
		}
	}

	// Save the trainer session regardless of whether eval succeeded
	// Store Infinity/-Infinity as large sentinel values for DB storage
	let storedEvalCp: number | null = null;
	if (result.evalCp != null) {
		if (result.evalCp === Infinity) storedEvalCp = 99999;
		else if (result.evalCp === -Infinity) storedEvalCp = -99999;
		else storedEvalCp = Math.round(result.evalCp);
	}

	await db.insert(trainerSession).values({
		userId,
		repertoireId,
		startFen,
		pgn,
		movesPlayed,
		finalEvalCp: storedEvalCp,
		rated: isRated,
		ratingBefore: result.ratingBefore,
		ratingAfter: result.ratingAfter,
		moveSource,
		completedAt: new Date()
	});

	return json(result);
};
