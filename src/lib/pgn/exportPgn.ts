/**
 * exportPgn.ts
 * ────────────
 * Converts a flat array of repertoire moves (fromFen → san → toFen) into a
 * standards-compliant PGN string with nested variations and comments.
 *
 * Pure function — no database or framework dependency.
 */

import { fenKey } from './index';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ── Public types ─────────────────────────────────────────────────────────────

export interface ExportMove {
	fromFen: string;
	toFen: string;
	san: string;
	notes: string | null;
	createdAt: number; // unix-ms timestamp, used for ordering
}

export interface ExportOptions {
	repertoireName: string;
	repertoireColor: 'WHITE' | 'BLACK';
	moves: ExportMove[];
}

// ── Internal types ───────────────────────────────────────────────────────────

interface MoveEdge {
	san: string;
	toFen: string;
	notes: string | null;
	createdAt: number;
}

interface TreeNode {
	san: string;
	toFen: string;
	notes: string | null;
	children: TreeNode[];
}

// ── Main export function ─────────────────────────────────────────────────────

/**
 * Build a PGN string from a flat list of repertoire moves.
 *
 * Returns a complete PGN with seven-tag roster headers and movetext that
 * preserves every variation using standard parenthesized notation.
 */
export function exportRepertoirePgn(opts: ExportOptions): string {
	const { repertoireName, repertoireColor, moves } = opts;

	// Build headers
	const today = new Date();
	const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

	const white = repertoireColor === 'WHITE' ? repertoireName : '?';
	const black = repertoireColor === 'BLACK' ? repertoireName : '?';

	const headers = [
		`[Event "Chessstack Repertoire"]`,
		`[Site "Chessstack"]`,
		`[Date "${dateStr}"]`,
		`[White "${escapeHeader(white)}"]`,
		`[Black "${escapeHeader(black)}"]`,
		`[Result "*"]`
	].join('\n');

	if (moves.length === 0) {
		return `${headers}\n\n*\n`;
	}

	// Build adjacency map: fenKey → edges, sorted by createdAt ascending
	const adj = buildAdjacencyMap(moves);

	// DFS to build ordered tree
	const visited = new Set<string>();
	const rootChildren = buildTree(STARTING_FEN, adj, visited);

	if (rootChildren.length === 0) {
		return `${headers}\n\n*\n`;
	}

	// Serialize tree to PGN movetext
	// Ply 1 = white's first move, ply 2 = black's first move, etc.
	const movetext = serializeNodes(rootChildren, 1, true);

	return `${headers}\n\n${movetext} *\n`;
}

// ── Adjacency map ────────────────────────────────────────────────────────────

function buildAdjacencyMap(moves: ExportMove[]): Map<string, MoveEdge[]> {
	const map = new Map<string, MoveEdge[]>();
	for (const m of moves) {
		const key = fenKey(m.fromFen);
		let arr = map.get(key);
		if (!arr) {
			arr = [];
			map.set(key, arr);
		}
		arr.push({
			san: m.san,
			toFen: m.toFen,
			notes: m.notes,
			createdAt: m.createdAt
		});
	}
	// Sort each group by createdAt so the first-added move becomes the mainline
	for (const arr of map.values()) {
		arr.sort((a, b) => a.createdAt - b.createdAt);
	}
	return map;
}

// ── Tree building (DFS) ──────────────────────────────────────────────────────

function buildTree(fen: string, adj: Map<string, MoveEdge[]>, visited: Set<string>): TreeNode[] {
	const key = fenKey(fen);
	const edges = adj.get(key);
	if (!edges) return [];

	// Mark visited to handle transpositions — only the first path to a
	// position "owns" its subtree. Later paths stop here.
	if (visited.has(key)) return [];
	visited.add(key);

	return edges.map((edge) => ({
		san: edge.san,
		toFen: edge.toFen,
		notes: edge.notes,
		children: buildTree(edge.toFen, adj, visited)
	}));
}

// ── PGN serialization ────────────────────────────────────────────────────────

/**
 * Serialize a list of sibling nodes into PGN movetext.
 *
 * The first node is the mainline continuation. Any remaining nodes are
 * alternative variations, each wrapped in parentheses.
 *
 * @param nodes     - sibling moves from the same position
 * @param ply       - 1-based ply number (1 = white's first move)
 * @param needsNum  - whether the next move needs a move number prefix
 */
function serializeNodes(nodes: TreeNode[], ply: number, needsNum: boolean): string {
	if (nodes.length === 0) return '';

	const parts: string[] = [];
	const mainline = nodes[0];
	const alternatives = nodes.slice(1);

	// Write the mainline move
	parts.push(formatMove(mainline.san, ply, needsNum));

	// Append annotation as PGN comment
	if (mainline.notes) {
		parts.push(`{${escapeComment(mainline.notes)}}`);
	}

	// Write each alternative as a parenthesized variation
	for (const alt of alternatives) {
		const varParts: string[] = [];
		// The variation starts at the same ply as the mainline move
		varParts.push(formatMove(alt.san, ply, true));
		if (alt.notes) {
			varParts.push(`{${escapeComment(alt.notes)}}`);
		}
		// Continue the variation's subtree
		const continuation = serializeNodes(alt.children, ply + 1, false);
		if (continuation) {
			varParts.push(continuation);
		}
		parts.push(`(${varParts.join(' ')})`);
	}

	// Continue the mainline subtree
	const mainContinuation = serializeNodes(mainline.children, ply + 1, alternatives.length > 0);
	if (mainContinuation) {
		parts.push(mainContinuation);
	}

	return parts.join(' ');
}

/**
 * Format a single SAN move with its move number prefix when needed.
 *
 * White moves: "1. e4"
 * Black moves (when number needed): "1... e5"
 * Black moves (continuing mainline): "e5"
 */
function formatMove(san: string, ply: number, needsNumber: boolean): string {
	const moveNum = Math.ceil(ply / 2);
	const isWhite = ply % 2 === 1;

	if (isWhite) {
		return `${moveNum}. ${san}`;
	}
	if (needsNumber) {
		return `${moveNum}... ${san}`;
	}
	return san;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape special characters in PGN header values. */
function escapeHeader(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape curly braces inside PGN comments. */
function escapeComment(text: string): string {
	return text.replace(/\}/g, '');
}
