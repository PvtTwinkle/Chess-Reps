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
