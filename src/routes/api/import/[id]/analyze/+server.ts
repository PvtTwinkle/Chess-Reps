// POST /api/import/:id/analyze — analyze an imported game against all matching repertoires.
//
// Loads the imported game's PGN, finds all repertoires matching the player color,
// runs analyzeGame() against each, and returns a summary so the client can show
// a repertoire picker if multiple match.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { importedGame, repertoire, userMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { parsePgn, analyzeGame, computeMatchDepth } from '$lib/pgn';

interface RepertoireAnalysis {
	repertoireId: number;
	repertoireName: string;
	issueCount: number;
	firstDeviationFen: string | null;
	matchDepth: number;
}

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'Invalid game ID');

	// Load the imported game and verify ownership.
	const [game] = await db
		.select()
		.from(importedGame)
		.where(and(eq(importedGame.id, id), eq(importedGame.userId, locals.user.id)));

	if (!game) throw error(404, 'Game not found');

	// Parse the PGN.
	let parsed;
	try {
		parsed = parsePgn(game.pgn);
	} catch (e) {
		throw error(400, `Invalid PGN: ${(e as Error).message}`);
	}

	// Find all repertoires matching the player color.
	const color = game.playerColor as 'WHITE' | 'BLACK';
	const matchingReps = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.userId, locals.user.id), eq(repertoire.color, color)));

	if (matchingReps.length === 0) {
		return json({
			game,
			analyses: [] as RepertoireAnalysis[],
			message: `No ${color.toLowerCase()} repertoires found. Create one first.`
		});
	}

	// Analyze against each matching repertoire, scoring by opening overlap.
	const analyses: RepertoireAnalysis[] = [];

	for (const rep of matchingReps) {
		const moves = await db
			.select()
			.from(userMove)
			.where(and(eq(userMove.userId, locals.user.id), eq(userMove.repertoireId, rep.id)));

		const matchDepth = computeMatchDepth(parsed.moves, moves, color);

		// Skip repertoires that don't cover the game's opening at all.
		if (matchDepth === 0) continue;

		const analysis = analyzeGame(parsed, moves, color);
		analyses.push({
			repertoireId: rep.id,
			repertoireName: rep.name,
			issueCount: analysis.issues.length,
			firstDeviationFen: analysis.firstDeviationFen,
			matchDepth
		});
	}

	// Sort by match depth descending — the best opening match first.
	analyses.sort((a, b) => b.matchDepth - a.matchDepth);

	// If same-color repertoires exist but none match this game's opening,
	// tell the user to create one for this opening.
	if (analyses.length === 0) {
		return json({
			game,
			analyses,
			message: `None of your ${color.toLowerCase()} repertoires match this game's opening. Create one first.`
		});
	}

	return json({ game, analyses });
};
