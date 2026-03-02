// GET /api/lichess/masters?fen=<fen>
//
// Server-side proxy for the Lichess Masters Opening Explorer API.
// Returns move popularity and win/draw/loss stats from master-level games.
//
// Responses are cached permanently in SQLite (masters_cache table) since
// master game stats don't change meaningfully. Each position is fetched
// from Lichess at most once — all subsequent requests are served locally.
//
// Graceful degradation: if the external API is unreachable, times out, or
// returns an error, this endpoint returns an empty result set with status 200
// rather than propagating the failure. Book and Engine tabs are unaffected.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { mastersCache } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/** Shape of each move returned to the client. */
export interface MastersMove {
	san: string;
	uci: string;
	white: number; // games won by white
	draws: number;
	black: number; // games won by black
	totalGames: number; // white + draws + black
	averageRating: number;
}

export interface MastersResponse {
	moves: MastersMove[];
	totalGames: number; // aggregate across all moves at this position
}

const LICHESS_MASTERS_URL = 'https://explorer.lichess.ovh/masters';
const TIMEOUT_MS = 5000;
const MAX_MOVES = 8;

const EMPTY_RESPONSE: MastersResponse = { moves: [], totalGames: 0 };

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const fen = url.searchParams.get('fen');
	if (!fen) throw error(400, 'fen query parameter is required');

	// ── 1. Check cache ────────────────────────────────────────────────────────
	const cached = db
		.select({ responseJson: mastersCache.responseJson })
		.from(mastersCache)
		.where(eq(mastersCache.fen, fen))
		.get();

	if (cached) {
		return json(JSON.parse(cached.responseJson) as MastersResponse);
	}

	// ── 2. Fetch from Lichess API ─────────────────────────────────────────────
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

		const apiUrl = `${LICHESS_MASTERS_URL}?fen=${encodeURIComponent(fen)}&topGames=0&moves=${MAX_MOVES}`;
		const res = await fetch(apiUrl, { signal: controller.signal });
		clearTimeout(timeout);

		if (res.status === 429) {
			console.warn('[masters] Rate limited by Lichess API');
			return json({ ...EMPTY_RESPONSE, rateLimited: true });
		}

		if (!res.ok) {
			console.warn(`[masters] Lichess API returned ${res.status}`);
			return json(EMPTY_RESPONSE);
		}

		const data = await res.json();
		const positionTotal = (data.white ?? 0) + (data.draws ?? 0) + (data.black ?? 0);

		const moves: MastersMove[] = (data.moves ?? []).map(
			(m: {
				san: string;
				uci: string;
				white: number;
				draws: number;
				black: number;
				averageRating?: number;
			}) => {
				const total = m.white + m.draws + m.black;
				return {
					san: m.san,
					uci: m.uci,
					white: m.white,
					draws: m.draws,
					black: m.black,
					totalGames: total,
					averageRating: m.averageRating ?? 0
				};
			}
		);

		const response: MastersResponse = { moves, totalGames: positionTotal };

		// ── 3. Store in cache ─────────────────────────────────────────────────
		// Only cache successful responses with data. Rate-limited and error
		// responses are not cached so they'll be retried on the next request.
		try {
			db.insert(mastersCache)
				.values({
					fen,
					responseJson: JSON.stringify(response),
					fetchedAt: Math.floor(Date.now() / 1000)
				})
				.onConflictDoNothing()
				.run();
		} catch (cacheErr) {
			// Cache write failure is non-fatal — log and continue.
			console.warn('[masters] Cache write failed:', cacheErr);
		}

		return json(response);
	} catch (err) {
		// Network error, timeout, or JSON parse failure — degrade gracefully.
		console.warn('[masters] Fetch failed:', err instanceof Error ? err.message : err);
		return json(EMPTY_RESPONSE);
	}
};
