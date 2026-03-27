// GET    /api/prep/:id — load a single prep with all its data
// PATCH  /api/prep/:id — update filter settings (minGames, excludedMoves)
// DELETE /api/prep/:id — delete a prep (cascade removes all moves)

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { opponentPreps, opponentMoves, prepMoves } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// ── GET ──────────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

	if (!prep) throw error(404, 'Prep not found');

	// Load opponent moves and prep moves in parallel
	const [oppMoves, userPrepMoves] = await Promise.all([
		db.select().from(opponentMoves).where(eq(opponentMoves.prepId, prepId)),
		db.select().from(prepMoves).where(eq(prepMoves.prepId, prepId))
	]);

	return json({ prep, opponentMoves: oppMoves, prepMoves: userPrepMoves });
};

// ── PATCH ────────────────────────────────────────────────────────────────────

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	// Verify ownership
	const [prep] = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

	if (!prep) throw error(404, 'Prep not found');

	const updates: Record<string, unknown> = {};

	if (typeof body.minGames === 'number') {
		updates.minGames = Math.max(1, Math.min(100, body.minGames));
	}

	if (Array.isArray(body.excludedMoves)) {
		// Validate: each entry should be a string
		const valid = body.excludedMoves.every((e: unknown) => typeof e === 'string');
		if (!valid) throw error(400, 'excludedMoves must be an array of strings');
		updates.excludedMoves = JSON.stringify(body.excludedMoves);
	}

	if (Object.keys(updates).length === 0) {
		throw error(400, 'No valid fields to update');
	}

	await db.update(opponentPreps).set(updates).where(eq(opponentPreps.id, prepId));

	return json({ updated: true });
};

// ── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	// Verify ownership before deleting
	const [prep] = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

	if (!prep) throw error(404, 'Prep not found');

	// FK cascade deletes opponent_moves and prep_moves automatically
	await db.delete(opponentPreps).where(eq(opponentPreps.id, prepId));

	return json({ deleted: true });
};
