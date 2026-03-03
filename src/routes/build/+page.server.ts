// Build mode page server load function.
//
// Grabs the active repertoire from the layout's shared data (via parent()),
// then loads all existing moves for that repertoire so the board can show
// what is already in the user's tree on first render.
//
// If no repertoire is active (user hasn't created one yet), redirects to
// the dashboard where the onboarding screen and "Create Repertoire" prompt live.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	// parent() gives us the layout data: user, repertoires, activeRepertoireId.
	// We call it here instead of re-querying the DB so the repertoire list is
	// always consistent with what the nav bar is showing.
	const { activeRepertoireId, repertoires } = await parent();

	// If the user has no repertoires or none is selected, send them to the
	// dashboard where the onboarding screen will guide them to create one.
	if (!activeRepertoireId) {
		redirect(302, '/');
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		redirect(302, '/');
	}

	// Load every move the user has saved for this repertoire.
	// The build page uses these on load to reconstruct the move tree so that
	// existing lines are visible in the sidebar immediately, before any
	// interaction. New moves are added to this list optimistically as the
	// user plays them.
	const moves = await db
		.select()
		.from(userMove)
		.where(
			and(eq(userMove.userId, locals.user!.id), eq(userMove.repertoireId, activeRepertoireId))
		);

	// Optional: a comma-separated SAN list passed from the Explorer "Build from here"
	// link. The client-side page replays these moves on first mount to jump straight
	// to that position instead of starting at the opening.
	const jumpLine = url.searchParams.get('line');

	return {
		repertoire: activeRep,
		moves,
		jumpLine
	};
};
