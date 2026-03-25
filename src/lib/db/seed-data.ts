// Auto-seed large reference datasets on first boot.
//
// After Drizzle migrations create the tables, this module checks whether the
// chessmont_moves and puzzle tables are empty. If they are (and the compressed
// dump files exist on disk), it restores them via `psql`. The dumps are baked
// into the Docker image at /app/data/ — in local dev the files don't exist and
// this module silently does nothing.
//
// Each restore is transactional (pg_dump wraps COPY in BEGIN/COMMIT), so a
// partial failure rolls back cleanly and the next startup retries.

import { existsSync, statSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { sql } from 'drizzle-orm';
import { getDb } from './index';

const DATA_DIR = '/app/data';

const SEED_FILES = [
	{
		table: 'chessmont_moves',
		file: `${DATA_DIR}/chessmont-moves-dump.sql.gz`,
		label: 'masters database'
	},
	{
		table: 'puzzle',
		file: `${DATA_DIR}/puzzles-dump.sql.gz`,
		label: 'puzzle database'
	},
	{
		table: 'lichess_moves',
		file: `${DATA_DIR}/lichess-moves-dump.sql.gz`,
		label: 'players database'
	},
	{
		table: 'celebrity_moves',
		file: `${DATA_DIR}/celebrity-moves-dump.sql.gz`,
		label: 'stars database'
	}
] as const;

/** Run a shell pipeline and return a promise that resolves on exit 0. */
function runPipeline(command: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn('sh', ['-c', command], {
			stdio: ['ignore', 'pipe', 'pipe']
		});

		let stderr = '';
		proc.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Command exited with code ${code}: ${stderr.trim()}`));
			}
		});

		proc.on('error', (err) => {
			reject(err);
		});
	});
}

/**
 * Seed empty reference tables from embedded dump files.
 *
 * Safe to call on every startup — returns immediately if tables already have
 * data or if the dump files are not present (local dev).
 */
export async function loadSeedData(): Promise<void> {
	const db = getDb();

	for (const { table, file, label } of SEED_FILES) {
		// In local dev the dump files don't exist — skip silently.
		// Resolve + startsWith guard satisfies eslint security/detect-non-literal-fs-filename.
		const resolved = path.resolve(file);
		if (!resolved.startsWith(DATA_DIR)) continue;
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		if (!existsSync(resolved)) continue;
		// Skip empty placeholder files (e.g. lichess dump before first import).
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		if (statSync(resolved).size === 0) continue;

		// Check if the table already has data. LIMIT 1 is fast even on an empty table.
		const rows = await db.execute(sql.raw(`SELECT 1 FROM ${table} LIMIT 1`));
		if (rows.length > 0) continue;

		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) {
			console.warn('[chessstack] DATABASE_URL not set — skipping seed data restore.');
			return;
		}

		console.log(`[chessstack] Loading ${label}...`);
		const start = Date.now();

		try {
			await runPipeline(`gunzip -c "${file}" | psql "${databaseUrl}"`);
			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			console.log(`[chessstack] Loading ${label}... done (${elapsed}s)`);
		} catch (err) {
			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			console.error(
				`[chessstack] Failed to load ${label} after ${elapsed}s:`,
				err instanceof Error ? err.message : err
			);
			console.error('[chessstack] The table is still empty — will retry on next restart.');
		}
	}
}
