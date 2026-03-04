// Puzzle page server load function.
//
// 1. Checks if any puzzles have been imported into the database
// 2. Fetches the active repertoire's moves
// 3. Looks up ECO names for positions in the repertoire
// 4. Finds distinct opening families that have matching puzzles
// 5. Returns filter metadata so the client can request puzzles

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userMove, ecoOpening, puzzle } from '$lib/db/schema';
import { eq, and, inArray, sql, count } from 'drizzle-orm';
import { normalizeOpening } from '$lib/puzzleMatching';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { activeRepertoireId, repertoires } = await parent();

	if (!locals.user) {
		redirect(302, '/login');
	}

	// Check if any puzzles have been imported at all
	const [puzzleCount] = await db.select({ count: count() }).from(puzzle);
	const hasImportedPuzzles = puzzleCount.count > 0;

	if (!hasImportedPuzzles) {
		return {
			hasImportedPuzzles: false,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0
		};
	}

	if (!activeRepertoireId) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0
		};
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0
		};
	}

	const userId = locals.user.id;

	// Get all destination FENs from the user's active repertoire.
	// These represent positions the user has studied.
	const moves = await db
		.select({ toFen: userMove.toFen })
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)));

	const toFens = [...new Set(moves.map((m) => m.toFen))];

	if (toFens.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0
		};
	}

	// Look up ECO opening names for those positions.
	const ecoMatches = await db
		.select({ name: ecoOpening.name })
		.from(ecoOpening)
		.where(inArray(ecoOpening.fen, toFens));

	// Normalize ECO names for matching against puzzle opening_family column.
	const ecoNames = [...new Set(ecoMatches.map((e) => e.name))];
	const normalizedNames = [...new Set(ecoNames.map(normalizeOpening))];

	if (normalizedNames.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0
		};
	}

	// Build prefix-match conditions: each normalized ECO name becomes
	// a LIKE 'name%' clause. This matches the exact variation AND any
	// sub-variations, but NOT sibling variations.
	const likePatterns = normalizedNames.map((n) => `${n}%`);

	// Get distinct opening families that match + total count
	const matchingFamilies = await db
		.selectDistinct({ family: puzzle.openingFamily })
		.from(puzzle)
		.where(
			sql`${puzzle.openingFamily} LIKE ANY(ARRAY[${sql.join(
				likePatterns.map((p) => sql`${p}`),
				sql`, `
			)}])`
		);

	const openingFamilies = matchingFamilies.map((r) => r.family).sort();

	// Count total matching puzzles
	const [matchCount] = await db
		.select({ count: count() })
		.from(puzzle)
		.where(
			sql`${puzzle.openingFamily} LIKE ANY(ARRAY[${sql.join(
				likePatterns.map((p) => sql`${p}`),
				sql`, `
			)}])`
		);

	return {
		hasImportedPuzzles: true,
		openingFamilies,
		totalMatchingPuzzles: matchCount.count
	};
};
