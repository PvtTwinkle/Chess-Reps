// Explorer page server load function.
//
// Loads all saved moves for the active repertoire so the explorer board can
// show the full tree immediately on render. Read-only — nothing is written here.
//
// Mirrors build/+page.server.ts. If no repertoire is active, redirects to the
// dashboard where the onboarding screen will guide the user to create one.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { activeRepertoireId, repertoires } = await parent();

	if (!activeRepertoireId) {
		redirect(302, '/');
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		redirect(302, '/');
	}

	const moves = db
		.select()
		.from(userMove)
		.where(and(eq(userMove.userId, locals.user!.id), eq(userMove.repertoireId, activeRepertoireId)))
		.all();

	return {
		repertoire: activeRep,
		moves
	};
};
