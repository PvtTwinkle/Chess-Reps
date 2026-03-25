// Drill mode page server load function.
//
// Loads the active repertoire's full move tree (for path reconstruction) and
// SR cards for drilling. By default only due cards (due <= now) are loaded.
//
// URL params alter behaviour:
//   ?mode=all          — load ALL cards regardless of due date
//   ?fromFen=<fen>     — scope cards to the subtree rooted at that position
//
// Cards for "lead-in" moves (before the repertoire's start position) are
// filtered out so the user only drills positions within scope.
//
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userMove, userRepertoireMove, userSettings } from '$lib/db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { fenKey } from '$lib/gaps';
import { sanitizeFen } from '$lib/fen';
import { getEffectiveStartFens, buildInScopeFens } from '$lib/repertoire';
import { nextIntervalLabel, Rating } from '$lib/fsrs';
import type { FSRSUserConfig } from '$lib/fsrs';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const { activeRepertoireId, repertoires } = await parent();

	if (!activeRepertoireId) {
		redirect(302, '/');
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		redirect(302, '/');
	}

	const userId = locals.user!.id;
	const now = new Date();
	const drillMode = url.searchParams.get('mode') === 'all' ? 'all' : 'due';
	const rawFromFen = url.searchParams.get('fromFen');
	const fromFen = rawFromFen ? sanitizeFen(rawFromFen) : null;

	// All moves in the repertoire — used by the client to reconstruct the path
	// from move 1 to each due card's position.
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)));

	// Load SR cards — either all cards or only those currently due.
	let dueCards =
		drillMode === 'all'
			? await db
					.select()
					.from(userRepertoireMove)
					.where(
						and(
							eq(userRepertoireMove.userId, userId),
							eq(userRepertoireMove.repertoireId, activeRepertoireId)
						)
					)
			: await db
					.select()
					.from(userRepertoireMove)
					.where(
						and(
							eq(userRepertoireMove.userId, userId),
							eq(userRepertoireMove.repertoireId, activeRepertoireId),
							lte(userRepertoireMove.due, now)
						)
					);

	// Scope cards to a subtree if fromFen is provided, otherwise use the
	// default lead-in filter (positions reachable from the repertoire start).
	if (fromFen) {
		const subtree = buildInScopeFens([fromFen], moves);
		dueCards = dueCards.filter((c) => subtree.has(fenKey(c.fromFen)));
	} else {
		const startFens = getEffectiveStartFens(
			activeRep.startFen ?? null,
			moves,
			activeRep.color as 'WHITE' | 'BLACK'
		);
		const inScope = buildInScopeFens(startFens, moves);
		dueCards = dueCards.filter((c) => inScope.has(fenKey(c.fromFen)));
	}

	// Load user FSRS settings for interval label computation.
	const [settings] = await db
		.select({
			fsrsDesiredRetention: userSettings.fsrsDesiredRetention,
			fsrsMaximumInterval: userSettings.fsrsMaximumInterval,
			fsrsRelearningMinutes: userSettings.fsrsRelearningMinutes
		})
		.from(userSettings)
		.where(eq(userSettings.userId, userId));

	const fsrsConfig: FSRSUserConfig = {
		requestRetention: settings?.fsrsDesiredRetention ?? 0.9,
		maximumInterval: settings?.fsrsMaximumInterval ?? 365,
		relearningMinutes: settings?.fsrsRelearningMinutes ?? 10
	};

	// Pre-compute interval labels for each card so the drill buttons
	// can show "Forgot · 10 min", "Unsure · 2 days", etc.
	const cardsWithLabels = dueCards.map((card) => ({
		...card,
		intervalLabels: {
			forgot: nextIntervalLabel(card, Rating.Again, now, fsrsConfig),
			unsure: nextIntervalLabel(card, Rating.Good, now, fsrsConfig),
			easy: nextIntervalLabel(card, Rating.Easy, now, fsrsConfig)
		}
	}));

	return {
		repertoire: activeRep,
		moves,
		dueCards: cardsWithLabels,
		drillMode,
		fromFen
	};
};
