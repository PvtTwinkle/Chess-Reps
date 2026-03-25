// GET /api/stars/players
//
// Returns the list of available celebrity players for the Stars tab dropdown.
// Queries the local star_players table — tiny result set (~20-30 rows max).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { starPlayers } from '$lib/db/schema';
import { asc } from 'drizzle-orm';

export interface StarPlayer {
	slug: string;
	displayName: string;
	category: string | null;
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const rows = await db
		.select({
			slug: starPlayers.slug,
			displayName: starPlayers.displayName,
			category: starPlayers.category
		})
		.from(starPlayers)
		.orderBy(asc(starPlayers.displayName));

	return json({ players: rows });
};
