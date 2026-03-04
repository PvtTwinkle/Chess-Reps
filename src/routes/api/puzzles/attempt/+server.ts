// POST /api/puzzles/attempt
//
// Records a puzzle attempt for the current user.
//
// Request body: { puzzleId: string, solved: boolean, timeMs?: number }
// Response:     { success: true }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { puzzleAttempt } from '$lib/db/schema';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	if (typeof body !== 'object' || body === null) {
		throw error(400, 'Invalid request body');
	}

	const { puzzleId, solved, timeMs } = body as Record<string, unknown>;

	if (typeof puzzleId !== 'string' || puzzleId.length === 0) {
		throw error(400, 'puzzleId must be a non-empty string');
	}
	if (typeof solved !== 'boolean') {
		throw error(400, 'solved must be a boolean');
	}
	if (timeMs !== undefined && timeMs !== null && typeof timeMs !== 'number') {
		throw error(400, 'timeMs must be a number or null');
	}

	await db.insert(puzzleAttempt).values({
		userId: locals.user.id,
		puzzleId,
		solved,
		timeMs: typeof timeMs === 'number' ? Math.round(timeMs) : null,
		attemptedAt: new Date()
	});

	return json({ success: true });
};
