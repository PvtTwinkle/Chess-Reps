// Shared helper for loading per-user FSRS config from the database.
//
// Three server-side callers need the same query + fallback logic:
//   - drill/grade (grading a card)
//   - review/fail-card (failing a card from game review)
//   - drill/+page.server.ts (computing interval labels)

import { db } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_RETENTION, DEFAULT_MAX_INTERVAL, DEFAULT_RELEARNING_MINUTES } from '$lib/fsrs';
import type { FSRSUserConfig } from '$lib/fsrs';

export async function loadFsrsConfig(userId: number): Promise<FSRSUserConfig> {
	const [settings] = await db
		.select({
			fsrsDesiredRetention: userSettings.fsrsDesiredRetention,
			fsrsMaximumInterval: userSettings.fsrsMaximumInterval,
			fsrsRelearningMinutes: userSettings.fsrsRelearningMinutes
		})
		.from(userSettings)
		.where(eq(userSettings.userId, userId));

	return {
		requestRetention: settings?.fsrsDesiredRetention ?? DEFAULT_RETENTION,
		maximumInterval: settings?.fsrsMaximumInterval ?? DEFAULT_MAX_INTERVAL,
		relearningMinutes: settings?.fsrsRelearningMinutes ?? DEFAULT_RELEARNING_MINUTES
	};
}
