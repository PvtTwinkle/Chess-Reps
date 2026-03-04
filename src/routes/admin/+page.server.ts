// Admin panel — data loader.
// Access is already guarded by hooks.server.ts (admin role required).

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';

const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';

export const load: PageServerLoad = async () => {
	const users = await db
		.select({
			id: user.id,
			username: user.username,
			role: user.role,
			enabled: user.enabled,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(user.createdAt);

	return { users, registrationMode: REGISTRATION_MODE };
};
