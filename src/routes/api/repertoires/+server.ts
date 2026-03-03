// GET  /api/repertoires  — list all repertoires for the logged-in user
// POST /api/repertoires  — create a new repertoire

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// ── GET ────────────────────────────────────────────────────────────────────────
// Returns an array of all repertoires belonging to the current user,
// ordered by creation date (oldest first).

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const rows = await db
		.select()
		.from(repertoire)
		.where(eq(repertoire.userId, locals.user.id))
		.orderBy(repertoire.createdAt);

	return json(rows);
};

// ── POST ───────────────────────────────────────────────────────────────────────
// Expects JSON body: { name: string, color: "WHITE" | "BLACK" }
// Returns the newly created repertoire row with HTTP 201.

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { name, color } = body;

	if (!name || typeof name !== 'string' || name.trim() === '') {
		throw error(400, 'name is required');
	}
	if (color !== 'WHITE' && color !== 'BLACK') {
		throw error(400, 'color must be "WHITE" or "BLACK"');
	}

	const [created] = await db
		.insert(repertoire)
		.values({
			userId: locals.user.id,
			name: name.trim(),
			color,
			createdAt: new Date()
		})
		.returning();

	return json(created, { status: 201 });
};
