// POST /api/drill/undo — restore a drill card's FSRS state to its pre-grade snapshot.
//
// When a user grades a card and immediately regrets it (before clicking "Next"),
// the client sends back the snapshot of FSRS fields it captured before grading.
// We validate ownership and write those fields back, effectively undoing the grade.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { cardId, previousState } = body;

	if (typeof cardId !== 'number') throw error(400, 'cardId must be a number');
	if (!previousState || typeof previousState !== 'object') {
		throw error(400, 'previousState is required');
	}

	// Validate FSRS field types and ranges before writing to DB.
	const ps = previousState as Record<string, unknown>;

	function optNum(key: string, min: number, max?: number): number | null {
		const v = ps[key];
		if (v == null) return null;
		if (typeof v !== 'number' || !Number.isFinite(v)) throw error(400, `${key} must be a number`);
		if (v < min || (max !== undefined && v > max)) throw error(400, `${key} out of range`);
		return v;
	}

	function optInt(key: string, min: number, max?: number): number | null {
		const v = optNum(key, min, max);
		if (v !== null && !Number.isInteger(v)) throw error(400, `${key} must be an integer`);
		return v;
	}

	function optDate(key: string): Date | null {
		const v = ps[key];
		if (v == null) return null;
		if (typeof v !== 'string') throw error(400, `${key} must be a date string`);
		const d = new Date(v);
		if (isNaN(d.getTime())) throw error(400, `${key} is not a valid date`);
		return d;
	}

	const validated = {
		stability: optNum('stability', 0),
		difficulty: optNum('difficulty', 0, 10),
		elapsedDays: optInt('elapsedDays', 0),
		scheduledDays: optInt('scheduledDays', 0),
		reps: optInt('reps', 0),
		lapses: optInt('lapses', 0),
		state: optInt('state', 0, 3),
		due: optDate('due'),
		lastReview: optDate('lastReview'),
		learningSteps: optInt('learningSteps', 0) ?? 0
	};

	// Verify the card belongs to this user.
	const [card] = await db
		.select({ id: userRepertoireMove.id })
		.from(userRepertoireMove)
		.where(and(eq(userRepertoireMove.id, cardId), eq(userRepertoireMove.userId, locals.user.id)));

	if (!card) throw error(404, 'Card not found');

	// Restore the pre-grade FSRS fields using validated values.
	await db.update(userRepertoireMove).set(validated).where(eq(userRepertoireMove.id, cardId));

	return json({ restored: true });
};
