// Web Worker — parses opponent PGNs and aggregates move statistics.
//
// Runs in a separate thread so the UI stays responsive while processing
// hundreds of games with chess.js. Communicates via postMessage.

import { Chess } from 'chess.js';
import type { AggregatedMove, WorkerParseMessage, WorkerOutboundMessage } from '../prep/types';

// Inline fenKey to avoid $lib alias issues in worker context.
// Same logic as src/lib/fen.ts — strips halfmove clock and fullmove counter.
function fenKey(fen: string): string {
	return fen.split(' ').slice(0, 4).join(' ');
}

/** Extract a PGN header value by name, e.g. getHeader(pgn, 'White') → 'DrNykterstein'. */
function getHeader(pgn: string, name: string): string | null {
	const regex = new RegExp(`\\[${name}\\s+"([^"]*)"\\]`);
	const match = pgn.match(regex);
	return match ? match[1] : null;
}

/** Determine the game result as { whiteWin, blackWin, draw } counts (0 or 1). */
function parseResult(pgn: string): { whiteWin: number; blackWin: number; draw: number } {
	const result = getHeader(pgn, 'Result');
	if (result === '1-0') return { whiteWin: 1, blackWin: 0, draw: 0 };
	if (result === '0-1') return { whiteWin: 0, blackWin: 1, draw: 0 };
	if (result === '1/2-1/2') return { whiteWin: 0, blackWin: 0, draw: 1 };
	return { whiteWin: 0, blackWin: 0, draw: 0 }; // unknown result
}

/** Maximum half-moves (plies) to process per game. Move 30 = ply 60. */
const MAX_PLY = 60;

/** Minimum games a move must appear in to be included in results. */
const MIN_GAMES = 2;

/** Post progress updates every N games to avoid message flooding. */
const PROGRESS_INTERVAL = 10;

function post(msg: WorkerOutboundMessage): void {
	self.postMessage(msg);
}

function handleParse(data: WorkerParseMessage): void {
	const { pgns, opponentUsername } = data;
	const usernameLower = opponentUsername.toLowerCase();

	// Aggregation map: "fen|san|oppColor" → stats
	const moveMap = new Map<string, AggregatedMove>();
	let gamesAsWhite = 0;
	let gamesAsBlack = 0;

	for (let i = 0; i < pgns.length; i++) {
		// Progress update
		if (i % PROGRESS_INTERVAL === 0) {
			post({ type: 'progress', completed: i, total: pgns.length });
		}

		try {
			const pgn = pgns[i];
			const chess = new Chess();
			chess.loadPgn(pgn);

			// Determine which color the opponent was playing
			const whitePlayer = getHeader(pgn, 'White') ?? '';
			const blackPlayer = getHeader(pgn, 'Black') ?? '';
			let opponentColor: 'w' | 'b';

			if (whitePlayer.toLowerCase() === usernameLower) {
				opponentColor = 'w';
				gamesAsWhite++;
			} else if (blackPlayer.toLowerCase() === usernameLower) {
				opponentColor = 'b';
				gamesAsBlack++;
			} else {
				// Username doesn't match either player — skip this game
				continue;
			}

			const result = parseResult(pgn);
			const history = chess.history({ verbose: true });

			// Replay the game from scratch to track FEN at each position
			const replay = new Chess();

			for (let ply = 0; ply < Math.min(history.length, MAX_PLY); ply++) {
				const beforeFen = fenKey(replay.fen());
				const move = history[ply];
				replay.move(move.san);
				const afterFen = fenKey(replay.fen());

				const key = `${beforeFen}|${move.san}|${opponentColor}`;

				const existing = moveMap.get(key);
				if (existing) {
					existing.gamesPlayed++;
					existing.whiteWins += result.whiteWin;
					existing.blackWins += result.blackWin;
					existing.draws += result.draw;
				} else {
					moveMap.set(key, {
						positionFen: beforeFen,
						moveSan: move.san,
						opponentColor,
						resultingFen: afterFen,
						gamesPlayed: 1,
						whiteWins: result.whiteWin,
						blackWins: result.blackWin,
						draws: result.draw
					});
				}
			}
		} catch {
			// Skip unparseable games silently — bad PGN data is expected occasionally
		}
	}

	// Two-pass filter: keep moves played >= MIN_GAMES ("core" tree), plus any
	// single-game continuations at positions reachable through the core tree.
	// This preserves leaf moves so users can see the end of established lines.
	const allMoves = Array.from(moveMap.values());
	const coreMoves = allMoves.filter((m) => m.gamesPlayed >= MIN_GAMES);
	const corePositions = new Set<string>();
	for (const m of coreMoves) {
		corePositions.add(m.positionFen);
		corePositions.add(m.resultingFen);
	}
	const moves = allMoves.filter(
		(m) => m.gamesPlayed >= MIN_GAMES || corePositions.has(m.positionFen)
	);

	post({
		type: 'result',
		moves,
		gamesAsWhite,
		gamesAsBlack
	});
}

// ── Worker entry point ───────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerParseMessage>) => {
	try {
		if (event.data.type === 'parse') {
			handleParse(event.data);
		}
	} catch (err) {
		post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
	}
};
