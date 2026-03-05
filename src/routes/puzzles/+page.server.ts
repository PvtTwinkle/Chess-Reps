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
import { normalizeOpening, removeParentNames } from '$lib/puzzleMatching';

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
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: null as string | null
		};
	}

	if (!activeRepertoireId) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: null as string | null
		};
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: null as string | null
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
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: activeRep.color
		};
	}

	// Look up ECO opening names for those positions.
	const ecoMatches = await db
		.select({ name: ecoOpening.name })
		.from(ecoOpening)
		.where(inArray(ecoOpening.fen, toFens));

	// Normalize ECO names for matching against puzzle opening_family column.
	// Then remove broad parent names when a more specific child exists —
	// e.g. if the user has "Scotch Game" and "Scotch Game: Scotch Gambit",
	// only keep the Scotch Gambit so we don't match all Scotch variations.
	const ecoNames = [...new Set(ecoMatches.map((e) => e.name))];
	const allNormalized = [...new Set(ecoNames.map(normalizeOpening))];
	const dedupedNames = removeParentNames(allNormalized);

	if (dedupedNames.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: activeRep.color
		};
	}

	// Verify each name actually exists as a puzzle opening_family.
	// Early/transit ECO positions like "King's Pawn Game" (1.e4) have
	// no exact match in the puzzle table — they only appear as prefixes
	// of unrelated families (e.g. "kings pawn game wayward queen attack").
	// Dropping names without exact matches prevents these transit positions
	// from pulling in thousands of irrelevant puzzles.
	const existCheck = await db
		.selectDistinct({ family: puzzle.openingFamily })
		.from(puzzle)
		.where(inArray(puzzle.openingFamily, dedupedNames));
	const existingFamilies = new Set(existCheck.map((r) => r.family));
	const normalizedNames = dedupedNames.filter((n) => existingFamilies.has(n));

	if (normalizedNames.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: activeRep.color
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

	// Extract distinct theme tags from matching puzzles.
	// Themes are stored as space-separated strings, so we use
	// string_to_array + unnest to decompose them into individual tags.
	const likePatternsForThemes = sql.join(
		likePatterns.map((p) => sql`${p}`),
		sql`, `
	);
	const themeRows = await db.execute(
		sql`SELECT DISTINCT unnest(string_to_array(themes, ' ')) AS theme
			FROM puzzle
			WHERE themes IS NOT NULL
			  AND ${puzzle.openingFamily} LIKE ANY(ARRAY[${likePatternsForThemes}])
			ORDER BY theme`
	);
	const availableThemes = (themeRows as unknown as { theme: string }[])
		.map((r) => r.theme)
		.filter((t) => t.length > 0);

	return {
		hasImportedPuzzles: true,
		openingFamilies,
		totalMatchingPuzzles: matchCount.count,
		availableThemes,
		repertoireColor: activeRep.color
	};
};
