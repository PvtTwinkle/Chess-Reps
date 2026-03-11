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
import { normalizeOpening, removeParentNames, getDeepestEcoNames } from '$lib/puzzleMatching';
import { fenKey, STARTING_FEN } from '$lib/fen';

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

	// Get all moves from the user's active repertoire (need both fromFen
	// and toFen to build the tree for tree-aware ECO selection).
	const moves = await db
		.select({ fromFen: userMove.fromFen, toFen: userMove.toFen })
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)));

	if (moves.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: activeRep.color
		};
	}

	// Look up ECO names for all positions in the repertoire.
	const allFens = [...new Set([...moves.map((m) => m.fromFen), ...moves.map((m) => m.toFen)])];
	const ecoRows = await db
		.select({ fen: ecoOpening.fen, name: ecoOpening.name })
		.from(ecoOpening)
		.where(inArray(ecoOpening.fen, allFens));

	const ecoByFen = new Map<string, string>();
	for (const row of ecoRows) {
		ecoByFen.set(fenKey(row.fen), row.name);
	}

	// Tree-aware ECO selection: DFS the repertoire tree and collect only
	// the deepest ECO name along each branch. Transit positions (e.g.
	// "King's Knight Opening" on the way to "Scotch Game") are overridden
	// by the deeper opening and excluded from puzzle matching.
	const rootFen = activeRep.startFen ?? STARTING_FEN;
	const deepestNames = getDeepestEcoNames(moves, ecoByFen, rootFen);

	// Normalize for matching against puzzle opening_family column.
	const normalizedDeepest = [...new Set([...deepestNames].map(normalizeOpening))];

	if (normalizedDeepest.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: activeRep.color
		};
	}

	// Progressive fallback: deepest ECO names may be too specific to
	// match any puzzle family (e.g. "Scotch Game, Classical Variation,
	// Intermezzo Variation"). Query broad prefixes (first 2 words) to
	// get candidate families, then truncate word-by-word until a match.
	const broadPrefixes = new Set<string>();
	for (const name of normalizedDeepest) {
		const words = name.split(' ');
		broadPrefixes.add(words.length >= 2 ? words.slice(0, 2).join(' ') : name);
	}
	const prefixPatterns = [...broadPrefixes].map((p) => `${p}%`);

	const familyRows = await db
		.selectDistinct({ family: puzzle.openingFamily })
		.from(puzzle)
		.where(
			sql`${puzzle.openingFamily} LIKE ANY(ARRAY[${sql.join(
				prefixPatterns.map((p) => sql`${p}`),
				sql`, `
			)}])`
		);
	const candidateFamilies = new Set(familyRows.map((r) => r.family));

	// For each deepest name, find the best matching puzzle family by
	// progressively removing the last word until we find an exact match.
	const resolved = new Set<string>();
	for (const name of normalizedDeepest) {
		if (candidateFamilies.has(name)) {
			resolved.add(name);
			continue;
		}
		let candidate = name;
		while (candidate.includes(' ')) {
			candidate = candidate.substring(0, candidate.lastIndexOf(' '));
			if (candidateFamilies.has(candidate)) {
				resolved.add(candidate);
				break;
			}
		}
	}

	// Remove parent names when a more specific child exists — e.g. if
	// one branch resolves to "Scotch Game" and another to "Scotch Game
	// Scotch Gambit", only keep the gambit.
	const normalizedNames = removeParentNames([...resolved]);

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
