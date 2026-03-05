// POST /api/repertoires/active  — record which repertoire the user is working in
//
// The active repertoire is stored in a browser cookie so the server knows
// which repertoire to scope build/drill data to on every page load.
// Calling this endpoint sets (or updates) that cookie.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request, cookies }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { id } = body;

	if (typeof id !== 'number') throw error(400, 'id must be a number');

	// Verify the requested repertoire actually belongs to this user.
	// Without this check, a user could set the cookie to any repertoire ID.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, locals.user.id)));

	if (!rep) throw error(404, 'Repertoire not found');

	// Persist for 1 year so the active repertoire survives browser restarts.
	// httpOnly keeps it out of client-side JS — only the server needs to read it.
	cookies.set('active_repertoire_id', String(id), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 365 // persist for 1 year so it survives browser restarts
	});

	return json({ success: true });
};
