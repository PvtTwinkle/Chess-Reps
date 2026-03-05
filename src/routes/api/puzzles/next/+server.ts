// GET /api/puzzles/next
//
// Returns one random puzzle matching the user's repertoire openings.
// Accepts query parameters for filtering:
//   families  — comma-separated list of normalized opening families
//   minRating — minimum puzzle rating (optional)
//   maxRating — maximum puzzle rating (optional)
//   themes    — comma-separated theme filter (optional, any match)
//
// Prefers puzzles the user hasn't attempted yet. If all matching puzzles
// have been attempted, returns a previously-attempted one.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { puzzle, puzzleAttempt } from '$lib/db/schema';
import { eq, and, sql, gte, lte, notInArray } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const userId = locals.user.id;

	// Parse filter parameters
	const familiesParam = url.searchParams.get('families');
	if (!familiesParam) {
		throw error(400, 'families parameter is required');
	}
	const families = familiesParam.split(',').filter((f) => f.length > 0);
	if (families.length === 0) {
		throw error(400, 'At least one opening family is required');
	}

	const minRating = url.searchParams.get('minRating');
	const maxRating = url.searchParams.get('maxRating');
	const themesParam = url.searchParams.get('themes');
	const colorParam = url.searchParams.get('color'); // 'WHITE' or 'BLACK'

	// Build the WHERE conditions
	// Prefix-match: each family becomes a LIKE 'family%' clause
	const likePatterns = families.map((f) => `${f}%`);
	const conditions = [
		sql`${puzzle.openingFamily} LIKE ANY(ARRAY[${sql.join(
			likePatterns.map((p) => sql`${p}`),
			sql`, `
		)}])`
	];

	if (minRating) {
		const min = parseInt(minRating);
		if (!isNaN(min)) conditions.push(gte(puzzle.rating, min));
	}
	if (maxRating) {
		const max = parseInt(maxRating);
		if (!isNaN(max)) conditions.push(lte(puzzle.rating, max));
	}
	// Color filter: the FEN's active color is who plays the setup move (opponent).
	// User plays the opposite side. So WHITE repertoire → FEN turn = 'b', BLACK → 'w'.
	if (colorParam === 'WHITE') {
		conditions.push(sql`split_part(${puzzle.fen}, ' ', 2) = 'b'`);
	} else if (colorParam === 'BLACK') {
		conditions.push(sql`split_part(${puzzle.fen}, ' ', 2) = 'w'`);
	}

	if (themesParam) {
		// Match puzzles that contain ANY of the specified themes
		const themes = themesParam.split(',').filter((t) => t.length > 0);
		if (themes.length > 0) {
			// Each theme must appear as a word in the space-separated themes field
			const themeConditions = themes.map((t) => sql`${puzzle.themes} ~ ${'\\m' + t + '\\M'}`);
			conditions.push(sql`(${sql.join(themeConditions, sql` OR `)})`);
		}
	}

	// Get puzzle IDs the user has already attempted
	const attemptedRows = await db
		.select({ puzzleId: puzzleAttempt.puzzleId })
		.from(puzzleAttempt)
		.where(eq(puzzleAttempt.userId, userId));
	const attemptedIds = attemptedRows.map((r) => r.puzzleId);

	// Try to find an unattempted puzzle first
	let result;
	if (attemptedIds.length > 0) {
		const unattemptedConditions = [...conditions, notInArray(puzzle.puzzleId, attemptedIds)];
		[result] = await db
			.select()
			.from(puzzle)
			.where(and(...unattemptedConditions))
			.orderBy(sql`RANDOM()`)
			.limit(1);
	}

	// If no unattempted puzzle found, fall back to any matching puzzle
	if (!result) {
		[result] = await db
			.select()
			.from(puzzle)
			.where(and(...conditions))
			.orderBy(sql`RANDOM()`)
			.limit(1);
	}

	if (!result) {
		return json(null);
	}

	return json(result);
};
