// Shared FEN utilities — canonical source for FEN normalization and validation.
// All other modules should import from here instead of defining their own copies.

/**
 * Strip the half-move clock and full-move counter from a FEN string.
 * Positions reached via different move orders compare equal if the first four
 * fields match (piece placement, active color, castling rights, en-passant).
 */
export function fenKey(fen: string): string {
	return fen.split(' ').slice(0, 4).join(' ');
}

/** Maximum length of a valid FEN string (generous upper bound). */
const MAX_FEN_LENGTH = 100;

/**
 * Validates that a FEN string is plausibly well-formed and within length limits.
 * This is a lightweight check for input sanitization, not a full chess legality
 * check — Chess.js handles that when the FEN is actually used.
 *
 * Returns the trimmed FEN if valid, or null if it should be rejected.
 */
export function sanitizeFen(fen: unknown): string | null {
	if (typeof fen !== 'string') return null;
	const trimmed = fen.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_FEN_LENGTH) return null;
	return trimmed;
}
