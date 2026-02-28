// Drill mode page server load function.
//
// Loads the active repertoire's full move tree (for path reconstruction) and
// all SR cards that are currently due (due <= now). Also loads user settings
// so the client knows whether sound is enabled.
//
// Cards for "lead-in" moves (before the repertoire's start position) are
// filtered out so the user only drills positions within scope.
//
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userMove, userRepertoireMove, userSettings } from '$lib/db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { fenKey } from '$lib/gaps';
import { getEffectiveStartFens, buildInScopeFens } from '$lib/repertoire';

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
	const now = new Date();

	// All moves in the repertoire — used by the client to reconstruct the path
	// from move 1 to each due card's position.
	const moves = db
		.select()
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)))
		.all();

	// All SR cards that are due right now (due <= now).
	let dueCards = db
		.select()
		.from(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, userId),
				eq(userRepertoireMove.repertoireId, activeRepertoireId),
				lte(userRepertoireMove.due, now)
			)
		)
		.all();

	// Filter out cards for lead-in moves (before the repertoire's start position).
	// Only positions reachable from the effective start FEN(s) are in scope.
	const startFens = getEffectiveStartFens(
		activeRep.startFen ?? null,
		moves,
		activeRep.color as 'WHITE' | 'BLACK'
	);
	const inScope = buildInScopeFens(startFens, moves);
	dueCards = dueCards.filter((c) => inScope.has(fenKey(c.fromFen)));

	// User settings: we need soundEnabled (and potentially other future settings).
	const settings = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();

	return {
		repertoire: activeRep,
		moves,
		dueCards,
		settings: settings ?? null
	};
};
