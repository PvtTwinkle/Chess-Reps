// GET  /api/prep      — list all opponent preps for the authenticated user
// POST /api/prep      — create a new prep with aggregated opponent move data
//
// The POST endpoint receives pre-aggregated move data from the client-side
// Web Worker and persists it in a single transaction.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { opponentPreps, opponentMoves } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import type { AggregatedMove } from '$lib/prep/types';

// ── GET ──────────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const preps = await db
		.select()
		.from(opponentPreps)
		.where(eq(opponentPreps.userId, locals.user.id))
		.orderBy(desc(opponentPreps.createdAt));

	return json(preps);
};

// ── POST ─────────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const {
		opponentName,
		platform,
		platformUsername,
		timeWindow,
		gamesAsWhite,
		gamesAsBlack,
		moves
	} = body as {
		opponentName: string;
		platform: string;
		platformUsername: string;
		timeWindow: string;
		gamesAsWhite: number;
		gamesAsBlack: number;
		moves: AggregatedMove[];
	};

	// Validate required fields
	if (!opponentName || typeof opponentName !== 'string')
		throw error(400, 'opponentName is required');
	if (opponentName.length > 100) throw error(400, 'opponentName is too long');
	if (platform !== 'LICHESS' && platform !== 'CHESSCOM')
		throw error(400, 'platform must be LICHESS or CHESSCOM');
	if (!platformUsername || typeof platformUsername !== 'string')
		throw error(400, 'platformUsername is required');
	if (!Array.isArray(moves)) throw error(400, 'moves must be an array');

	const now = new Date();

	const result = await db.transaction(async (tx) => {
		// Create the prep record
		const [prep] = await tx
			.insert(opponentPreps)
			.values({
				userId: locals.user!.id,
				opponentName,
				platform,
				platformUsername,
				timeWindow: timeWindow || null,
				gamesAsWhite: gamesAsWhite || 0,
				gamesAsBlack: gamesAsBlack || 0,
				lastFetchedAt: now,
				createdAt: now
			})
			.returning();

		// Batch-insert opponent moves in chunks to avoid PostgreSQL parameter limit
		const BATCH_SIZE = 1000;
		const rows = moves.map((m) => ({
			prepId: prep.id,
			positionFen: fenKey(m.positionFen),
			moveSan: m.moveSan,
			opponentColor: m.opponentColor,
			resultingFen: fenKey(m.resultingFen),
			gamesPlayed: m.gamesPlayed,
			whiteWins: m.whiteWins,
			blackWins: m.blackWins,
			draws: m.draws
		}));
		for (let i = 0; i < rows.length; i += BATCH_SIZE) {
			await tx.insert(opponentMoves).values(rows.slice(i, i + BATCH_SIZE));
		}

		return prep;
	});

	return json(result, { status: 201 });
};
