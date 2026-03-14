// Database connection singleton.
//
// This file does four things when the app first starts:
//   1. Opens a connection to the PostgreSQL database
//   2. Runs any pending migrations — creates all tables on first run,
//      applies only new migrations on subsequent runs
//   3. Creates a default user if no user exists yet
//   4. Exports the `db` object that every other file uses to query the database
//
// IMPORTANT: The connection and initialization are lazy — they only happen when
// `dbReady` is first awaited (in hooks.server.ts). This is critical because
// SvelteKit's `vite build` evaluates server modules at build time to generate
// the production bundle. If we connected eagerly at module scope, the build
// would crash with ECONNREFUSED (no database available during Docker build).

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { count } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import path from 'path';
import * as schema from './schema';
import { user } from './schema';
import { loadSeedData } from './seed-data';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration via environment variables
//
// DATABASE_URL:    PostgreSQL connection string.
//                 Development default: postgresql://chessstack:chessstack@localhost:5432/chessstack
//                 Docker: set in docker-compose.yml pointing to the postgres service.
//
// DEFAULT_USERNAME: Username for the automatically created first user.
//                 Default: "admin"
//
// DEFAULT_PASSWORD: Password for the automatically created first user.
//                 Default: "changeme"
//                 IMPORTANT: Change this in production via docker-compose.yml.
// ─────────────────────────────────────────────────────────────────────────────

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://chessstack:chessstack@localhost:5432/chessstack';

// ─────────────────────────────────────────────────────────────────────────────
// Lazy connection — the postgres.js client and Drizzle instance are created on
// first access, not at import time. This prevents the build from crashing when
// no database is available (e.g. inside a Docker build stage).
// ─────────────────────────────────────────────────────────────────────────────

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
	if (!_db) {
		const sql = postgres(DATABASE_URL, {
			onnotice: () => {} // suppress PostgreSQL NOTICE messages (e.g. "already exists" from migrations)
		});
		_db = drizzle(sql, { schema });
	}
	return _db;
}

// Re-export as `db` for convenience. Every call goes through the lazy getter.
// This is a getter-based export so it defers connection until first use.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
	get(_target, prop, receiver) {
		return Reflect.get(getDb(), prop, receiver);
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Async initialization — migrations + default user
//
// dbReady is a lazy promise: it only runs when first awaited (in hooks.server.ts).
// This ensures no database connection is attempted during `vite build`.
// ─────────────────────────────────────────────────────────────────────────────

let _dbReadyPromise: Promise<void> | null = null;

export const dbReady: Promise<void> = {
	then(onfulfilled, onrejected) {
		if (!_dbReadyPromise) {
			_dbReadyPromise = initDatabase();
		}
		return _dbReadyPromise.then(onfulfilled, onrejected);
	}
} as Promise<void>;

async function initDatabase(): Promise<void> {
	const realDb = getDb();

	// migrate() checks which migration files have already been applied and runs
	// only the ones that have not run yet. On first run it creates all tables.
	await migrate(realDb, {
		migrationsFolder: path.join(process.cwd(), 'drizzle', 'migrations')
	});
	console.log('[chessstack] Database migrations complete.');

	// Seed large reference tables (masters + puzzles) from embedded dump files.
	// Skips silently in local dev (no dump files) or if tables already have data.
	await loadSeedData();

	// Default user creation — same logic as before, now async.
	const [existingUserCount] = await realDb.select({ count: count() }).from(user);

	if (existingUserCount && existingUserCount.count === 0) {
		const username = process.env.DEFAULT_USERNAME ?? 'admin';
		const password = process.env.DEFAULT_PASSWORD ?? 'changeme';

		// Hash the password before storing it. The number 10 is the cost factor.
		const passwordHash = await bcrypt.hash(password, 10);

		await realDb.insert(user).values({
			username,
			passwordHash,
			role: 'admin', // first user is always admin
			createdAt: new Date()
		});

		console.log(`[chessstack] Default user "${username}" created on first run.`);
		console.log(
			'[chessstack] Set DEFAULT_USERNAME and DEFAULT_PASSWORD environment variables to customise this.'
		);
	}
}
