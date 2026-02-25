// FSRS spaced repetition helpers.
//
// This module wraps the ts-fsrs library with the conversions needed to move
// data between our SQLite schema and the ts-fsrs Card type.
//
// Only three ratings are exposed: Again, Good, Easy. Hard is skipped because
// for chess openings the user either knows the move or they don't — there's
// rarely a meaningful "partial credit" state.

import { fsrs, generatorParameters, Rating, State, createEmptyCard } from 'ts-fsrs';
import type { Card, Grade } from 'ts-fsrs';

// Re-export so callers never need to import ts-fsrs directly.
export { Rating, State };

// Single shared FSRS instance. `enable_fuzz` adds a small random variance to
// scheduled intervals so that cards don't all cluster on the same future day.
const f = fsrs(generatorParameters({ enable_fuzz: true }));

// ─── Types ────────────────────────────────────────────────────────────────────

// The subset of user_repertoire_move fields that FSRS reads and writes.
// This matches the Drizzle inferred type for that table.
export interface FSRSCardRow {
	id: number;
	due: Date | null;
	stability: number | null;
	difficulty: number | null;
	elapsedDays: number | null;
	scheduledDays: number | null;
	reps: number | null;
	lapses: number | null;
	state: number | null;
	lastReview: Date | null;
	learningSteps: number;
}

// The updated FSRS fields returned after grading — ready to write back to DB.
export interface FSRSUpdate {
	due: Date;
	stability: number;
	difficulty: number;
	elapsedDays: number;
	scheduledDays: number;
	reps: number;
	lapses: number;
	state: number;
	lastReview: Date;
	learningSteps: number;
}

// ─── Conversions ──────────────────────────────────────────────────────────────

// Convert a DB row into a ts-fsrs Card object.
// For new cards (state=null or 0, no prior reviews), createEmptyCard() is used
// as the base and only the due date is overridden to avoid resetting it.
function dbRowToCard(row: FSRSCardRow): Card {
	if (row.state === null || row.state === State.New) {
		// Brand new card — use ts-fsrs defaults for all fields.
		const empty = createEmptyCard();
		return { ...empty, due: row.due ?? new Date() };
	}

	// Reviewed card — reconstruct from stored fields.
	return {
		due: row.due ?? new Date(),
		stability: row.stability ?? 0,
		difficulty: row.difficulty ?? 0,
		elapsed_days: row.elapsedDays ?? 0,
		scheduled_days: row.scheduledDays ?? 0,
		learning_steps: row.learningSteps ?? 0,
		reps: row.reps ?? 0,
		lapses: row.lapses ?? 0,
		state: (row.state ?? State.New) as State,
		last_review: row.lastReview ?? undefined
	};
}

// Convert a ts-fsrs Card result back into DB-ready fields.
function cardToUpdate(card: Card, now: Date): FSRSUpdate {
	return {
		due: card.due,
		stability: card.stability,
		difficulty: card.difficulty,
		elapsedDays: card.elapsed_days,
		scheduledDays: card.scheduled_days,
		reps: card.reps,
		lapses: card.lapses,
		state: card.state,
		lastReview: card.last_review ?? now,
		learningSteps: card.learning_steps
	};
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply a rating to a card and return the updated fields to write back to DB.
 *
 * @param row   The current user_repertoire_move row for this card.
 * @param rating  Again (1), Good (3), or Easy (4).
 * @param now   The time of review (caller provides so tests can freeze time).
 */
export function gradeCard(row: FSRSCardRow, rating: Rating, now: Date): FSRSUpdate {
	const card = dbRowToCard(row);
	const scheduling = f.repeat(card, now);
	const result = scheduling[rating as Grade];
	return cardToUpdate(result.card, now);
}

/**
 * Returns a human-readable label for the next review interval after a given
 * rating, e.g. "10 min", "1 day", "4 days". Used in drill grading buttons.
 */
export function nextIntervalLabel(row: FSRSCardRow, rating: Rating, now: Date): string {
	const card = dbRowToCard(row);
	const scheduling = f.repeat(card, now);
	const result = scheduling[rating as Grade];
	const nextDue = result.card.due;
	const diffMs = nextDue.getTime() - now.getTime();
	const diffMin = Math.round(diffMs / 60000);

	if (diffMin < 60) return `${diffMin} min`;
	const diffHr = Math.round(diffMin / 60);
	if (diffHr < 24) return `${diffHr} hr`;
	const diffDay = Math.round(diffHr / 24);
	return `${diffDay} day${diffDay !== 1 ? 's' : ''}`;
}
