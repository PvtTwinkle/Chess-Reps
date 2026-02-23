// Database schema — defined with Drizzle ORM.
//
// This file is the single source of truth for every table in the database.
// It is written in TypeScript, not SQL. Drizzle Kit reads this file and
// generates the actual SQL (CREATE TABLE statements) in drizzle/migrations/.
//
// Two groups of tables:
//   1. Shared book tables  — opening theory bundled with the app (read-only at runtime)
//   2. User tables         — personal repertoires, SR state, settings (never shared)

import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BOOK TABLES
// Ships with the app as seed data. Never written to at runtime.
// Updated when the user pulls a new Docker image.
// ─────────────────────────────────────────────────────────────────────────────

// Every unique board position in the opening book, identified by its FEN string.
// FEN (Forsyth-Edwards Notation) is a standard text format that fully describes
// a chess position — piece placement, whose turn it is, castling rights, etc.
export const bookPosition = sqliteTable('book_position', {
	fen: text('fen').primaryKey()
});

// Individual moves within the shared opening book.
// Each row is one move: "from this position, this move leads to that position."
export const bookMove = sqliteTable('book_move', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	fromFen: text('from_fen').notNull(), // position before the move
	toFen: text('to_fen').notNull(), // position after the move
	san: text('san').notNull(), // move in Standard Algebraic Notation, e.g. "e4", "Nf3"
	annotation: text('annotation'), // curator notes, e.g. "main line", "aggressive"
	contributor: text('contributor') // name of the person who contributed this move
});

// ECO (Encyclopaedia of Chess Openings) codes — the naming system for openings.
// Bundled statically so the app can show "B90 · Sicilian Defense, Najdorf Variation"
// without any network request.
export const ecoOpening = sqliteTable('eco_opening', {
	code: text('code').primaryKey(), // e.g. "B90"
	name: text('name').notNull(), // e.g. "Sicilian Defense, Najdorf Variation"
	fen: text('fen').notNull() // the FEN of the position this name applies to
});

// ─────────────────────────────────────────────────────────────────────────────
// USER TABLES
// Personal data. Lives only on the user's own instance. Never shared.
// Every table includes user_id even though only one user exists today —
// this makes adding multi-user support later a UI problem, not a schema problem.
// ─────────────────────────────────────────────────────────────────────────────

// The login account. One row per user (one row total in a self-hosted instance).
export const user = sqliteTable('user', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(), // bcrypt hash — plain text is never stored
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Active login sessions. One row per logged-in browser session.
// The `id` (a random UUID) is stored as a cookie in the browser.
// On every request, the server reads the cookie, looks it up here,
// and retrieves the associated user_id to identify who is logged in.
// Sessions expire after 30 days. Logging out deletes the row immediately.
export const session = sqliteTable('session', {
	id: text('id').primaryKey(), // random UUID — this is what goes in the cookie
	userId: integer('user_id')
		.notNull()
		.references(() => user.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull() // 30 days from login
});

// Per-user configuration. One row per user.
export const userSettings = sqliteTable('user_settings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => user.id),
	stockfishDepth: integer('stockfish_depth').notNull().default(15), // higher = stronger but slower
	defaultDrillMode: text('default_drill_mode').notNull().default('MAIN'), // "MAIN", "PUNISHMENT", or "MIXED"
	boardTheme: text('board_theme').notNull().default('blue'), // e.g. "blue", "green", "brown"
	pieceSet: text('piece_set').notNull().default('cburnett'), // e.g. "cburnett", "merida", "alpha"
	soundEnabled: integer('sound_enabled', { mode: 'boolean' }).notNull().default(true),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

// A named opening repertoire. Users can have multiple (e.g. "White - e4", "Black vs d4").
export const repertoire = sqliteTable('repertoire', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => user.id),
	name: text('name').notNull(), // e.g. "White - e4 lines"
	color: text('color').notNull(), // "WHITE" or "BLACK" — which side the user plays
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Every move the user has added to a repertoire.
// This is the raw move record — what move was played and how it was sourced.
// The spaced repetition state lives separately in user_repertoire_move.
export const userMove = sqliteTable('user_move', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => user.id),
	repertoireId: integer('repertoire_id')
		.notNull()
		.references(() => repertoire.id),
	fromFen: text('from_fen').notNull(), // position before the move
	toFen: text('to_fen').notNull(), // position after the move
	san: text('san').notNull(), // move in Standard Algebraic Notation
	type: text('type').notNull(), // "MAIN" (standard prep) or "PUNISHMENT" (response to a blunder)
	source: text('source').notNull(), // "BOOK" (from shared book), "PERSONAL", or "STOCKFISH"
	notes: text('notes'), // optional user annotation on this move
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Spaced repetition state for each user-owned move that needs drilling.
// One row per drillable move. The FSRS algorithm uses these fields to decide
// when to show each position again. Only the user's own moves are drilled
// (not opponent moves — you don't need to memorise what your opponent plays).
export const userRepertoireMove = sqliteTable('user_repertoire_move', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => user.id),
	repertoireId: integer('repertoire_id')
		.notNull()
		.references(() => repertoire.id),
	fromFen: text('from_fen').notNull(), // the position the user must respond to
	san: text('san').notNull(), // the correct move
	type: text('type').notNull(), // "MAIN" or "PUNISHMENT"

	// FSRS spaced repetition fields — managed by the ts-fsrs library, not manually.
	// These determine when this card is next due and how well it has been learned.
	due: integer('due', { mode: 'timestamp' }), // when this card should next be reviewed
	stability: real('stability'), // how well the memory has consolidated (higher = longer interval)
	difficulty: real('difficulty'), // how hard the card is for this user (1–10)
	elapsedDays: integer('elapsed_days'), // days since last review
	scheduledDays: integer('scheduled_days'), // days until next review was scheduled
	reps: integer('reps'), // total number of successful reviews
	lapses: integer('lapses'), // number of times the user forgot this card
	state: integer('state'), // 0=New, 1=Learning, 2=Review, 3=Relearning
	lastReview: integer('last_review', { mode: 'timestamp' }) // when it was last reviewed
});

// A game the user has imported and reviewed for deviations from their repertoire.
export const reviewedGame = sqliteTable('reviewed_game', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => user.id),
	repertoireId: integer('repertoire_id')
		.notNull()
		.references(() => repertoire.id),
	pgn: text('pgn').notNull(), // full PGN of the reviewed game
	source: text('source').notNull(), // "MANUAL" (pasted) or "LICHESS" (imported)
	lichessGameId: text('lichess_game_id'), // Lichess game ID, used to prevent duplicate imports
	deviationFen: text('deviation_fen'), // the position where the user went off-book
	playedAt: integer('played_at', { mode: 'timestamp' }), // when the original game was played
	reviewedAt: integer('reviewed_at', { mode: 'timestamp' }).notNull(), // when the user reviewed it here
	notes: text('notes')
});

// A completed drill session — used to power the dashboard stats and review history chart.
export const drillSession = sqliteTable('drill_session', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => user.id),
	repertoireId: integer('repertoire_id')
		.notNull()
		.references(() => repertoire.id),
	mode: text('mode').notNull(), // "MAIN", "PUNISHMENT", or "MIXED"
	cardsReviewed: integer('cards_reviewed').notNull().default(0),
	cardsCorrect: integer('cards_correct').notNull().default(0),
	startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
	completedAt: integer('completed_at', { mode: 'timestamp' }) // null if session was abandoned
});
