// PATCH  /api/repertoires/[id]  — rename a repertoire
// DELETE /api/repertoires/[id]  — delete a repertoire and all its data

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
	repertoire,
	userMove,
	userRepertoireMove,
	reviewedGame,
	drillSession
} from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

// ── PATCH ──────────────────────────────────────────────────────────────────────
// Expects JSON body: { name: string }
// Verifies the repertoire belongs to the current user before updating.

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'Invalid id');

	// Ownership check — never allow renaming another user's repertoire.
	const existing = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, locals.user.id)))
		.get();

	if (!existing) throw error(404, 'Repertoire not found');

	const body = await request.json();
	const { name } = body;

	if (!name || typeof name !== 'string' || name.trim() === '') {
		throw error(400, 'name is required');
	}

	const updated = db
		.update(repertoire)
		.set({ name: name.trim() })
		.where(eq(repertoire.id, id))
		.returning()
		.get();

	return json(updated);
};

// ── DELETE ─────────────────────────────────────────────────────────────────────
// Deletes the repertoire and ALL associated data in a single transaction.
//
// A transaction is an "all or nothing" operation — if any deletion fails,
// the database rolls back to its state before the transaction started.
// This prevents half-deleted repertoires with orphaned rows in other tables.
//
// Deletion order matters because of foreign key constraints:
// child rows (moves, sessions) must be deleted before the parent (repertoire).

export const DELETE: RequestHandler = ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'Invalid id');

	// Ownership check.
	const existing = db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, locals.user.id)))
		.get();

	if (!existing) throw error(404, 'Repertoire not found');

	db.transaction((tx) => {
		// Delete child rows first (foreign key references the repertoire row).
		tx.delete(userMove).where(eq(userMove.repertoireId, id)).run();
		tx.delete(userRepertoireMove).where(eq(userRepertoireMove.repertoireId, id)).run();
		tx.delete(reviewedGame).where(eq(reviewedGame.repertoireId, id)).run();
		tx.delete(drillSession).where(eq(drillSession.repertoireId, id)).run();
		// Delete the repertoire itself last.
		tx.delete(repertoire).where(eq(repertoire.id, id)).run();
	});

	return json({ success: true });
};
