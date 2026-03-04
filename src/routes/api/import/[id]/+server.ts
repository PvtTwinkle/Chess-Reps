// PATCH /api/import/:id — update an imported game's status.
//
// Used to skip or un-skip games in the import queue.
// Body: { status: 'skipped' | 'pending' }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { importedGame } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'Invalid game ID');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { status } = body;
	if (status !== 'skipped' && status !== 'pending') {
		throw error(400, 'status must be "skipped" or "pending"');
	}

	// Verify the game belongs to this user.
	const [game] = await db
		.select()
		.from(importedGame)
		.where(and(eq(importedGame.id, id), eq(importedGame.userId, locals.user.id)));

	if (!game) throw error(404, 'Game not found');

	await db.update(importedGame).set({ status }).where(eq(importedGame.id, id));

	return json({ updated: true });
};
