// POST /api/import/parse
//
// Parse a PGN with variations and compare against the user's existing
// repertoire to produce an import preview with conflict detection.
//
// Input:  { repertoireId: number, pgn: string }
// Output: ImportPreview (new moves, duplicates, conflicts, parse errors)
//
// This endpoint is stateless — no server-side storage between parse and
// execute. The client holds the preview and sends resolved moves back.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { parseVariationPgn } from '$lib/pgn/parseVariations';
import { detectConflicts } from '$lib/pgn/detectConflicts';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	const user = locals.user;

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { repertoireId, pgn } = body;

	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId must be a number');
	if (!pgn || typeof pgn !== 'string') throw error(400, 'pgn is required');

	// Verify repertoire ownership
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));
	if (!rep) throw error(404, 'Repertoire not found');

	// Parse the PGN into edges
	let parsed;
	try {
		parsed = parseVariationPgn(pgn, rep.color as 'WHITE' | 'BLACK');
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to parse PGN');
	}

	if (parsed.edges.length === 0) {
		throw error(400, 'PGN produced no valid moves');
	}

	// Load existing repertoire moves for conflict comparison
	const existingMoves = await db
		.select({ fromFen: userMove.fromFen, san: userMove.san })
		.from(userMove)
		.where(and(eq(userMove.userId, user.id), eq(userMove.repertoireId, repertoireId)));

	// Detect conflicts
	const preview = detectConflicts(parsed.edges, existingMoves, parsed.errors);

	return json(preview);
};
