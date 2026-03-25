// Rating bracket definitions for the Players tab.
//
// The numeric ID (0–7) is stored in the database and passed through the API.
// The label is displayed in the UI dropdown. Bracket 0 covers the wide beginner
// range (0–1000); above that, each bracket is 200 ELO wide.
// Games with players rated 2400+ are excluded (covered by the Masters/Chessmont tab).

export const RATING_BRACKETS = [
	{ id: 0, label: '0–1000', min: 0, max: 1000 },
	{ id: 1, label: '1001–1200', min: 1001, max: 1200 },
	{ id: 2, label: '1201–1400', min: 1201, max: 1400 },
	{ id: 3, label: '1401–1600', min: 1401, max: 1600 },
	{ id: 4, label: '1601–1800', min: 1601, max: 1800 },
	{ id: 5, label: '1801–2000', min: 1801, max: 2000 },
	{ id: 6, label: '2001–2200', min: 2001, max: 2200 },
	{ id: 7, label: '2201–2400', min: 2201, max: 2400 }
] as const;

export const DEFAULT_BRACKET_ID = 3; // 1401–1600

/** Returns the bracket ID (0–7) for a given ELO rating, or null if >= 2400. */
export function bracketForRating(elo: number): number | null {
	if (elo >= 2400) return null;
	if (elo <= 1000) return 0;
	// 1001–1200 → 1, 1201–1400 → 2, 1401–1600 → 3, etc.
	return Math.min(7, Math.floor((elo - 1001) / 200) + 1);
}
