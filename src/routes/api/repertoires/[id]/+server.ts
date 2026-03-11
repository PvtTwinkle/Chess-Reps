// PATCH  /api/repertoires/[id]  — update repertoire settings (name, startFen)
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
import { fenKey } from '$lib/fen';

// ── PATCH ──────────────────────────────────────────────────────────────────────
// Expects JSON body: { name?: string, startFen?: string | null }
// At least one field must be provided.
// Verifies the repertoire belongs to the current user before updating.

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'Invalid id');

	// Ownership check.
	const [existing] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, locals.user.id)));

	if (!existing) throw error(404, 'Repertoire not found');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const updates: Record<string, unknown> = {};

	// Handle name update.
	if ('name' in body) {
		const { name } = body;
		if (!name || typeof name !== 'string' || name.trim() === '') {
			throw error(400, 'name must be a non-empty string');
		}
		updates.name = name.trim();
	}

	// Handle startFen update (null = reset to default, string = custom start).
	if ('startFen' in body) {
		const { startFen } = body;
		if (startFen !== null && (typeof startFen !== 'string' || startFen.trim() === '')) {
			throw error(400, 'startFen must be a FEN string or null');
		}
		if (typeof startFen === 'string' && startFen.length > 100) {
			throw error(400, 'startFen is too long');
		}
		updates.startFen = typeof startFen === 'string' ? fenKey(startFen) : null;
	}

	if (Object.keys(updates).length === 0) {
		throw error(400, 'At least one field (name, startFen) is required');
	}

	const [updated] = await db
		.update(repertoire)
		.set(updates)
		.where(eq(repertoire.id, id))
		.returning();

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

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'Invalid id');

	// Ownership check.
	const [existing] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, locals.user.id)));

	if (!existing) throw error(404, 'Repertoire not found');

	await db.transaction(async (tx) => {
		// Delete child rows first (foreign key references the repertoire row).
		await tx.delete(userMove).where(eq(userMove.repertoireId, id));
		await tx.delete(userRepertoireMove).where(eq(userRepertoireMove.repertoireId, id));
		await tx.delete(reviewedGame).where(eq(reviewedGame.repertoireId, id));
		await tx.delete(drillSession).where(eq(drillSession.repertoireId, id));
		// Delete the repertoire itself last.
		await tx.delete(repertoire).where(eq(repertoire.id, id));
	});

	return json({ success: true });
};
