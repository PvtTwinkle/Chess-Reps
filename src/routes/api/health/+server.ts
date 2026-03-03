import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { count } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	// Verify the database is reachable by running a trivial query.
	// This will throw if the database is unreachable or migrations failed.
	const [result] = await db.select({ count: count() }).from(user);
	return json({ status: 'ok', db: result !== undefined ? 'ok' : 'error' });
};
