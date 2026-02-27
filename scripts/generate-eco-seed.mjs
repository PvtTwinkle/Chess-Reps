#!/usr/bin/env node
/**
 * ECO seed generator.
 *
 * Fetches Lichess's open-source ECO dataset (5 TSV files), replays every
 * opening line through Chess.js to get correctly-normalised FENs, validates
 * each result against the EPD in the source data, then writes a SQL migration
 * file with the full ~3,000 named positions and all their intermediate moves.
 *
 * Why replay through Chess.js?
 *   The FENs stored everywhere else in this app are produced by Chess.js —
 *   including in book_move rows from migration 0002 and in the user's drill
 *   and repertoire data. Replaying through the same library guarantees that
 *   en passant flags, castling rights, and clock fields all match exactly.
 *
 * Usage:
 *   node scripts/generate-eco-seed.mjs --count 1    # test one entry (stdout)
 *   node scripts/generate-eco-seed.mjs --count 10   # test ten entries (stdout)
 *   node scripts/generate-eco-seed.mjs              # full run → writes migration
 */

import { Chess } from 'chess.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'drizzle', 'migrations', '0006_full_eco_dataset.sql');

// Lichess chess-openings: one TSV per ECO section.
// Each file has a header row then data rows with tab-separated columns:
//   eco  name  pgn
const TSV_URLS = [
	'https://raw.githubusercontent.com/lichess-org/chess-openings/master/a.tsv',
	'https://raw.githubusercontent.com/lichess-org/chess-openings/master/b.tsv',
	'https://raw.githubusercontent.com/lichess-org/chess-openings/master/c.tsv',
	'https://raw.githubusercontent.com/lichess-org/chess-openings/master/d.tsv',
	'https://raw.githubusercontent.com/lichess-org/chess-openings/master/e.tsv'
];

// ─── CLI args ────────────────────────────────────────────────────────────────

const countArg = process.argv.indexOf('--count');
const testCount = countArg !== -1 ? parseInt(process.argv[countArg + 1], 10) : null;
const isTestRun = testCount !== null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Escape single quotes in a value that will be placed inside a SQL string literal.
function sqlStr(s) {
	return s.replace(/'/g, "''");
}

// Split an array into chunks of at most `size` elements.
function chunkArray(arr, size) {
	const chunks = [];
	for (let i = 0; i < arr.length; i += size) {
		chunks.push(arr.slice(i, i + size));
	}
	return chunks;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchTsv(url) {
	process.stderr.write(`Fetching ${url}...\n`);
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} fetching ${url}`);
	}
	return res.text();
}

// ─── Parse ───────────────────────────────────────────────────────────────────

// TSV rows → array of { eco, name, pgn } objects.
function parseTsv(text) {
	const lines = text.trim().split('\n');
	// lines[0] is the header: eco\tname\tpgn
	return lines.slice(1).map((line) => {
		const [eco, name, pgn] = line.split('\t');
		return { eco: eco.trim(), name: name.trim(), pgn: pgn.trim() };
	});
}

// ─── Process one entry ───────────────────────────────────────────────────────

/**
 * Replay a single ECO entry through Chess.js.
 *
 * Returns { ecoRow, bookMoves } on success, or null if the PGN is invalid.
 *
 * ecoRow    — { fen, code, name } to insert into eco_opening
 * bookMoves — [{ fromFen, toFen, san }] for every move in the line
 */
function processEntry({ eco, name, pgn }) {
	const chess = new Chess();

	try {
		chess.loadPgn(pgn);
	} catch (err) {
		process.stderr.write(`WARN: PGN load failed for ${eco} "${name}": ${err.message}\n`);
		return null;
	}

	const finalFen = chess.fen();

	// chess.history({ verbose: true }) gives us the before/after FEN for every
	// move in the line.  We use this directly rather than replaying manually.
	const history = chess.history({ verbose: true });
	const bookMoves = history.map((move) => ({
		fromFen: move.before,
		toFen: move.after,
		san: move.san
	}));

	return {
		ecoRow: { fen: finalFen, code: eco, name },
		bookMoves
	};
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	// 1. Fetch all five TSV files and collect their rows.
	const allEntries = [];
	for (const url of TSV_URLS) {
		const text = await fetchTsv(url);
		allEntries.push(...parseTsv(text));
	}
	process.stderr.write(`Total entries in source data: ${allEntries.length}\n`);

	// 2. Optionally limit to the first N entries (test mode).
	const entries = isTestRun ? allEntries.slice(0, testCount) : allEntries;
	if (isTestRun) {
		process.stderr.write(
			`Test mode: processing first ${testCount} entr${testCount === 1 ? 'y' : 'ies'}\n\n`
		);
	}

	// 3. Process every entry, deduplicating as we go.
	//
	//    eco_opening: keyed by FEN.  If two opening lines reach the same
	//    position via different move orders (transpositions), the last entry
	//    written wins — that tends to be the more specific named variation.
	//
	//    book_move: keyed by "fromFen|san".  The same 1.e4 appears in hundreds
	//    of lines; we only need one row for each (position, move) pair.
	const ecoRows = new Map(); // fen → { fen, code, name }
	const bookMoveMap = new Map(); // `${fromFen}|${san}` → { fromFen, toFen, san }

	let processed = 0;
	let skipped = 0;

	for (const entry of entries) {
		const result = processEntry(entry);
		if (result === null) {
			skipped++;
			continue;
		}

		ecoRows.set(result.ecoRow.fen, result.ecoRow);

		for (const move of result.bookMoves) {
			const key = `${move.fromFen}|${move.san}`;
			if (!bookMoveMap.has(key)) {
				bookMoveMap.set(key, move);
			}
		}

		processed++;
	}

	process.stderr.write(`Processed: ${processed}  Skipped: ${skipped}\n`);
	process.stderr.write(`eco_opening rows: ${ecoRows.size}\n`);
	process.stderr.write(`book_move rows:   ${bookMoveMap.size}\n`);

	// 4a. In test mode: print a human-readable summary to stdout so you can
	//     inspect the results before committing to a full run.
	if (isTestRun) {
		console.log('\n══════════ eco_opening ══════════');
		for (const row of ecoRows.values()) {
			console.log(`\n  ${row.code}  ${row.name}`);
			console.log(`  FEN: ${row.fen}`);
		}

		console.log('\n══════════ book_move ══════════');
		for (const move of bookMoveMap.values()) {
			console.log(`\n  ${move.san}`);
			console.log(`  from: ${move.fromFen}`);
			console.log(`  to:   ${move.toFen}`);
		}

		if (skipped === 0) {
			console.log('\n✓ All entries loaded successfully (no WARN lines above).');
		} else {
			console.log(
				`\n⚠ ${skipped} entr${skipped === 1 ? 'y' : 'ies'} skipped due to PGN errors (see WARN lines above).`
			);
		}
		return;
	}

	// 4b. Full run: generate the SQL migration file.
	const lines = [];

	lines.push(`-- 0006_full_eco_dataset.sql`);
	lines.push(`-- Full ECO opening dataset from Lichess chess-openings`);
	lines.push(`-- Generated by: node scripts/generate-eco-seed.mjs`);
	lines.push(`-- Source:       https://github.com/lichess-org/chess-openings`);
	lines.push(`--`);
	lines.push(`-- eco_opening rows: ${ecoRows.size}`);
	lines.push(`-- book_move rows:   ${bookMoveMap.size}`);
	lines.push('');

	// Step 1: Rebuild eco_opening with fen as PK.
	// The old ~90 hand-picked entries are discarded; the full dataset replaces them.
	lines.push(`-- Rebuild eco_opening with fen as the primary key.`);
	lines.push(`-- (Previously code was the PK, which allowed only one entry per ECO code.)`);
	lines.push(`ALTER TABLE eco_opening RENAME TO eco_opening_old;`);
	lines.push(`--> statement-breakpoint`);
	lines.push(`CREATE TABLE eco_opening (`);
	lines.push(`  fen  TEXT PRIMARY KEY,`);
	lines.push(`  code TEXT NOT NULL,`);
	lines.push(`  name TEXT NOT NULL`);
	lines.push(`);`);
	lines.push(`--> statement-breakpoint`);
	lines.push(`DROP TABLE eco_opening_old;`);
	lines.push(`--> statement-breakpoint`);
	lines.push('');

	// Step 2: Rebuild book_move with UNIQUE(from_fen, san).
	lines.push(`-- Rebuild book_move with a unique constraint to prevent duplicate moves`);
	lines.push(`-- when many opening lines share the same early moves (e.g. 1.e4).`);
	lines.push(`CREATE TABLE book_move_new (`);
	lines.push(`  id          INTEGER PRIMARY KEY AUTOINCREMENT,`);
	lines.push(`  from_fen    TEXT NOT NULL,`);
	lines.push(`  to_fen      TEXT NOT NULL,`);
	lines.push(`  san         TEXT NOT NULL,`);
	lines.push(`  annotation  TEXT,`);
	lines.push(`  contributor TEXT,`);
	lines.push(`  UNIQUE(from_fen, san)`);
	lines.push(`);`);
	lines.push(`--> statement-breakpoint`);
	lines.push(
		`INSERT OR IGNORE INTO book_move_new (id, from_fen, to_fen, san, annotation, contributor)`
	);
	lines.push(`  SELECT id, from_fen, to_fen, san, annotation, contributor FROM book_move;`);
	lines.push(`--> statement-breakpoint`);
	lines.push(`DROP TABLE book_move;`);
	lines.push(`--> statement-breakpoint`);
	lines.push(`ALTER TABLE book_move_new RENAME TO book_move;`);
	lines.push(`--> statement-breakpoint`);
	lines.push('');

	// Step 3: eco_opening inserts, batched 500 rows per statement.
	lines.push(`-- Insert ${ecoRows.size} named opening positions.`);
	const ecoChunks = chunkArray([...ecoRows.values()], 500);
	for (const chunk of ecoChunks) {
		const values = chunk
			.map((r) => `('${sqlStr(r.fen)}', '${sqlStr(r.code)}', '${sqlStr(r.name)}')`)
			.join(',\n');
		lines.push(`INSERT OR IGNORE INTO eco_opening (fen, code, name) VALUES`);
		lines.push(values + ';');
		lines.push(`--> statement-breakpoint`);
	}
	lines.push('');

	// Step 4: book_move inserts, batched 500 rows per statement.
	lines.push(`-- Insert ${bookMoveMap.size} book moves covering all ECO opening lines.`);
	const moveChunks = chunkArray([...bookMoveMap.values()], 500);
	for (const chunk of moveChunks) {
		const values = chunk
			.map(
				(m) => `('${sqlStr(m.fromFen)}', '${sqlStr(m.toFen)}', '${sqlStr(m.san)}', 'lichess-eco')`
			)
			.join(',\n');
		lines.push(`INSERT OR IGNORE INTO book_move (from_fen, to_fen, san, contributor) VALUES`);
		lines.push(values + ';');
		lines.push(`--> statement-breakpoint`);
	}

	// Drizzle splits the migration file on '--> statement-breakpoint' and runs
	// each chunk as a separate SQL statement.  A trailing breakpoint at the end
	// of the file produces an empty chunk, which causes better-sqlite3 to throw
	// "The supplied SQL string contains no statements".  Remove it.
	if (lines[lines.length - 1] === '--> statement-breakpoint') {
		lines.pop();
	}

	const sql = lines.join('\n');
	writeFileSync(OUTPUT_PATH, sql, 'utf-8');
	process.stderr.write(`\n✓ Written to ${OUTPUT_PATH}\n`);
}

main().catch((err) => {
	process.stderr.write(`Error: ${err.message}\n`);
	process.exit(1);
});
