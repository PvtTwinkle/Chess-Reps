// Opening trainer rating utilities.
//
// Converts Stockfish centipawn evaluations into an Elo-style rating change.
// The system uses a sigmoid function to map eval to a 0.0-1.0 score, then
// applies a standard Elo expected-score calculation against the opponent
// bracket midpoint.

import { RATING_BRACKETS } from '$lib/ratings';

/** Default K-factor for rating updates (standard chess rapid K-factor). */
const DEFAULT_K = 32;

/**
 * Convert a Stockfish centipawn evaluation to a 0.0-1.0 score from the
 * player's perspective using a logistic sigmoid.
 *
 * Examples (from player's perspective):
 *   +400cp -> 0.91, +200cp -> 0.76, 0cp -> 0.50, -200cp -> 0.24, -400cp -> 0.09
 *
 * Mate scores should be passed as +/- Infinity.
 */
export function evalToScore(evalCp: number, playerColor: 'WHITE' | 'BLACK'): number {
	// evalCp is from white's perspective; flip for black
	const playerEval = playerColor === 'WHITE' ? evalCp : -evalCp;

	// Handle mate scores
	if (!isFinite(playerEval)) {
		return playerEval > 0 ? 1.0 : 0.0;
	}

	return 1 / (1 + Math.pow(10, -playerEval / 400));
}

/**
 * Compute the Elo rating change given a score (0.0-1.0), adjusting for the
 * difficulty of the opponent bracket relative to the player's rating.
 *
 * When the bracket is above the player's rating, the expected score is lower
 * (so gains are larger and losses smaller). When below, the opposite applies.
 *
 * bracketMid: midpoint of the opponent rating bracket (e.g. 1500 for 1401-1600)
 * playerRating: the user's current trainer rating
 */
export function computeRatingChange(
	score: number,
	bracketMid: number,
	playerRating: number,
	K: number = DEFAULT_K
): number {
	// Standard Elo expected score: E = 1 / (1 + 10^((Ro - Rp) / 400))
	// where Ro = opponent rating (bracket midpoint), Rp = player rating
	const expected = 1 / (1 + Math.pow(10, (bracketMid - playerRating) / 400));
	return Math.round(K * (score - expected));
}

/**
 * Get the midpoint rating for a bracket ID (0-7).
 * Used as the "opponent rating" in the Elo calculation.
 * For masters (bracket -1 or null), use 2500.
 */
export function bracketMidpoint(bracketId: number | null): number {
	if (bracketId === null || bracketId < 0) return 2500; // Masters
	const bracket = RATING_BRACKETS[bracketId];
	if (!bracket) return 1500; // fallback for out-of-range
	return Math.round((bracket.min + bracket.max) / 2);
}

/** Shape of a completed trainer evaluation result. */
export interface TrainerEvalResult {
	evalCp: number | null;
	score: number | null;
	ratingBefore: number | null;
	ratingAfter: number | null;
	ratingChange: number | null;
}
