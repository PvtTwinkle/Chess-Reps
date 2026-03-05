// Puzzle opening name matching.
//
// Maps ECO opening names from the user's repertoire to Lichess puzzle
// opening tags. Both use essentially the same opening names, but with
// different formatting:
//
//   ECO:     "Sicilian Defense, Najdorf Variation"
//   Lichess: "Sicilian_Defense_Najdorf_Variation"
//
// The normalizeOpening() function strips formatting differences so both
// produce: "sicilian defense najdorf variation".
//
// IMPORTANT: This must produce identical output to normalize_opening()
// in scripts/puzzle-import.py. If you change one, change the other.

/**
 * Normalize an opening name for matching between ECO names and
 * Lichess puzzle opening tags.
 *
 * Strips underscores, commas, colons, apostrophes, lowercases, and
 * collapses whitespace. The same function exists in Python in
 * scripts/puzzle-import.py — keep them in sync.
 */
export function normalizeOpening(name: string): string {
	let s = name.replace(/_/g, ' ');
	s = s.replace(/[,:'":]/g, '');
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Remove broad parent names when a more specific child exists.
 *
 * Given ["scotch game", "scotch game scotch gambit", "sicilian defense",
 * "sicilian defense alapin variation"], returns only the specific ones:
 * ["scotch game scotch gambit", "sicilian defense alapin variation"].
 *
 * A name is considered a parent if another name in the set starts with
 * it followed by a space (ensuring word-boundary matching, not just
 * substring). This prevents "scotch game" from matching all Scotch
 * variations when the user only plays the Scotch Gambit.
 */
export function removeParentNames(names: string[]): string[] {
	// Sort shortest first so parents come before children.
	const sorted = [...names].sort((a, b) => a.length - b.length);
	const result: string[] = [];

	for (const name of sorted) {
		// Check if any longer name in the set starts with this name + space.
		const isParent = sorted.some(
			(other) => other.length > name.length && other.startsWith(name + ' ')
		);
		if (!isParent) {
			result.push(name);
		}
	}

	return result;
}
