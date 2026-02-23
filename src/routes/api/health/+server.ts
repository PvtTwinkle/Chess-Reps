import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { count } from 'drizzle-orm';

export const GET: RequestHandler = () => {
	// Verify the database is reachable by running a trivial query.
	// This will throw if the database file is missing or migrations failed.
	// Full health check implementation comes in Step 7.
	const result = db.select({ count: count() }).from(user).get();
	return json({ status: 'ok', db: result !== undefined ? 'ok' : 'error' });
};
