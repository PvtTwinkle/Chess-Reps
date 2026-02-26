// Review mode page server.
//
// LOAD: returns the active repertoire, all its moves, the 20 most recent
//       reviewed games for the history list, and user settings.
//
// ACTION analyzeGame: receives a PGN + player color from the form submission,
//   parses it, runs deviation analysis against the active repertoire, and
//   returns the full GameAnalysis to the client. The game is NOT saved to the
//   database here — only when the user clicks "Save Review" (POST /api/review/save).

import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { repertoire, userMove, reviewedGame, userSettings } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { parsePgn, analyzeGame } from '$lib/pgn';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { activeRepertoireId, repertoires } = await parent();

	if (!activeRepertoireId) {
		redirect(302, '/');
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		redirect(302, '/');
	}

	const userId = locals.user!.id;

	// All moves in the active repertoire — passed to the client so the Svelte
	// component can call analyzeGame via the form action without a second round-trip.
	// (The action re-queries these on submission; the load data is for the history list.)
	const moves = db
		.select()
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)))
		.all();

	// Past reviewed games for this repertoire — displayed as a history list on the input screen.
	const recentGames = db
		.select()
		.from(reviewedGame)
		.where(and(eq(reviewedGame.userId, userId), eq(reviewedGame.repertoireId, activeRepertoireId)))
		.orderBy(desc(reviewedGame.reviewedAt))
		.limit(20)
		.all();

	const settings = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();

	return {
		repertoire: activeRep,
		moves,
		recentGames,
		settings: settings ?? null
	};
};

export const actions: Actions = {
	analyzeGame: async ({ locals, request, cookies }) => {
		if (!locals.user) return fail(401, { error: 'Not authenticated' });

		// Form actions don't have access to parent() — read the active repertoire
		// from the cookie directly, matching the logic in +layout.server.ts.
		const cookieVal = cookies.get('active_repertoire_id');
		const activeRepertoireId = cookieVal ? parseInt(cookieVal) : null;
		if (!activeRepertoireId || isNaN(activeRepertoireId)) {
			return fail(400, { error: 'No active repertoire selected' });
		}

		const activeRep = db
			.select()
			.from(repertoire)
			.where(and(eq(repertoire.id, activeRepertoireId), eq(repertoire.userId, locals.user.id)))
			.get();
		if (!activeRep) return fail(400, { error: 'Active repertoire not found' });

		const form = await request.formData();
		const pgn = (form.get('pgn') as string | null)?.trim() ?? '';
		const colorOverride = form.get('playerColor') as string | null;

		if (!pgn) return fail(400, { error: 'PGN is required' });

		// Allow the user to override which color they played.
		// Falls back to the active repertoire's color if not specified.
		const playerColor: 'WHITE' | 'BLACK' =
			colorOverride === 'WHITE' || colorOverride === 'BLACK'
				? colorOverride
				: (activeRep.color as 'WHITE' | 'BLACK');

		// Load all repertoire moves to pass to analyzeGame.
		const moves = db
			.select()
			.from(userMove)
			.where(and(eq(userMove.userId, locals.user.id), eq(userMove.repertoireId, activeRep.id)))
			.all();

		let parsed;
		try {
			parsed = parsePgn(pgn);
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}

		const analysis = analyzeGame(parsed, moves, playerColor);

		return {
			analysis,
			parsedPgn: parsed.pgn,
			headers: parsed.headers,
			playerColor
		};
	}
};
