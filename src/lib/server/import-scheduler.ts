// Background scheduler for automatic game import.
//
// When the GAME_IMPORT_INTERVAL_MINUTES environment variable is set to a
// positive number, this module runs a setInterval that periodically fetches
// new games from Lichess and Chess.com for all users who have configured
// platform usernames in their settings.
//
// This module is imported and started from hooks.server.ts — it only runs
// at runtime on the actual server, never during vite build.

import { db } from '$lib/db';
import { userSettings, importedGame } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { fetchLichessGames } from '$lib/lichess';
import { fetchChesscomGames } from '$lib/chesscom';

const DELAY_BETWEEN_USERS_MS = 2000;

let started = false;

/**
 * Start the background import scheduler. Safe to call multiple times —
 * only the first call actually starts the interval.
 */
export function startImportScheduler(): void {
	if (started) return;
	started = true;

	const intervalMinutes = parseInt(process.env.GAME_IMPORT_INTERVAL_MINUTES ?? '0');
	if (intervalMinutes <= 0) {
		console.log('[chessstack] Auto-import disabled (GAME_IMPORT_INTERVAL_MINUTES=0).');
		return;
	}

	console.log(`[chessstack] Auto-import enabled: checking every ${intervalMinutes} minutes.`);

	// Run once on startup (after a short delay to let the app finish initialising),
	// then at the configured interval.
	setTimeout(runImportCycle, 5000);
	setInterval(runImportCycle, intervalMinutes * 60 * 1000);
}

async function runImportCycle(): Promise<void> {
	console.log('[chessstack] Starting auto-import cycle...');

	try {
		// Find all users with at least one platform username configured.
		const allSettings = await db
			.select({
				userId: userSettings.userId,
				lichessUsername: userSettings.lichessUsername,
				chesscomUsername: userSettings.chesscomUsername,
				lastLichessImport: userSettings.lastLichessImport,
				lastChesscomImport: userSettings.lastChesscomImport
			})
			.from(userSettings);

		let totalImported = 0;

		for (const settings of allSettings) {
			// Lichess
			if (settings.lichessUsername) {
				try {
					const count = await importGamesForUser(
						settings.userId,
						'LICHESS',
						settings.lichessUsername,
						settings.lastLichessImport
					);
					totalImported += count;
				} catch (e) {
					console.error(
						`[chessstack] Lichess import failed for user ${settings.userId}:`,
						e instanceof Error ? e.message : String(e)
					);
				}
				await sleep(DELAY_BETWEEN_USERS_MS);
			}

			// Chess.com
			if (settings.chesscomUsername) {
				try {
					const count = await importGamesForUser(
						settings.userId,
						'CHESSCOM',
						settings.chesscomUsername,
						settings.lastChesscomImport
					);
					totalImported += count;
				} catch (e) {
					console.error(
						`[chessstack] Chess.com import failed for user ${settings.userId}:`,
						e instanceof Error ? e.message : String(e)
					);
				}
				await sleep(DELAY_BETWEEN_USERS_MS);
			}
		}

		console.log(
			`[chessstack] Auto-import cycle complete. ${totalImported} new game${totalImported !== 1 ? 's' : ''} imported.`
		);
	} catch (e) {
		console.error(
			'[chessstack] Auto-import cycle error:',
			e instanceof Error ? e.message : String(e)
		);
	}
}

async function importGamesForUser(
	userId: number,
	source: 'LICHESS' | 'CHESSCOM',
	username: string,
	watermark: Date | null
): Promise<number> {
	// Fetch games from the platform.
	const games =
		source === 'LICHESS'
			? await fetchLichessGames(username, {
					since: watermark ? watermark.getTime() + 1 : undefined,
					max: 50
				})
			: await fetchChesscomGames(username, {
					since: watermark ?? undefined,
					max: 50
				});

	let latestPlayedAt = watermark;
	let imported = 0;

	for (const game of games) {
		try {
			const rows = await db
				.insert(importedGame)
				.values({
					userId,
					pgn: game.pgn,
					source,
					externalGameId: game.id,
					playerColor: game.playerColor,
					opponentName: game.opponentName,
					opponentRating: game.opponentRating,
					playerRating: game.playerRating,
					timeControl: game.timeControl,
					result: game.result,
					playedAt: game.playedAt,
					importedAt: new Date(),
					status: 'pending'
				})
				.onConflictDoNothing()
				.returning({ id: importedGame.id });

			if (rows.length > 0) {
				imported++;
			}

			if (game.playedAt && (!latestPlayedAt || game.playedAt > latestPlayedAt)) {
				latestPlayedAt = game.playedAt;
			}
		} catch {
			// Skip individual game insertion failures.
		}
	}

	// Update the watermark.
	if (latestPlayedAt && latestPlayedAt !== watermark) {
		const field =
			source === 'LICHESS'
				? { lastLichessImport: latestPlayedAt }
				: { lastChesscomImport: latestPlayedAt };

		await db
			.update(userSettings)
			.set({ ...field, updatedAt: new Date() })
			.where(eq(userSettings.userId, userId));
	}

	if (imported > 0) {
		console.log(`[chessstack] Imported ${imported} ${source} games for user ${userId}.`);
	}

	return imported;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
