// Stockfish UCI wrapper — spawns Stockfish as a child process.
//
// Each analysis request spawns a fresh Stockfish process, communicates via
// stdin/stdout using the UCI protocol, and kills the process when done.
//
// Analysis flow per request:
//   1. Spawn the Stockfish binary
//   2. Send "uci" and "setoption name MultiPV value N" then "isready"
//   3. Wait for "readyok", then send "position fen <fen>" and "go depth <d>"
//   4. Collect "info" lines — each carries a candidate move and its score
//   5. When "bestmove" arrives, kill the process and return the results
//
// If the engine binary is not installed (e.g. running `npm run dev` without
// Stockfish on PATH), getTopMoves returns [] instead of throwing so the app
// degrades gracefully.

import { spawn } from 'child_process';

// Path to the Stockfish binary. Debian installs to /usr/games/stockfish.
// For local dev, set STOCKFISH_BIN=stockfish to rely on PATH resolution,
// or point to wherever your local binary lives.
const STOCKFISH_BIN = process.env.STOCKFISH_BIN ?? '/usr/games/stockfish';

// Default timeout when no explicit value is provided (10 seconds).
const DEFAULT_TIMEOUT_MS = 10_000;

export interface StockfishMove {
	// The move in UCI notation: from-square + to-square + optional promotion piece.
	// e.g. "e2e4", "g1f3", "e7e8q" (pawn promotes to queen)
	uci: string;

	// Evaluation in centipawns from the CURRENT SIDE TO MOVE's perspective.
	// Positive = good for the side to move. null when the engine returns a
	// mate score instead.
	scoreCp: number | null;

	// Moves to mate, from the CURRENT SIDE TO MOVE's perspective.
	// Positive = the side to move is delivering mate.
	// null when the engine returns a centipawn score instead.
	scoreMate: number | null;
}

// A snapshot of engine analysis at a particular search depth.
export interface StockfishUpdate {
	// The search depth this snapshot represents.
	depth: number;
	// All PVs at this depth (sorted by multipv index, best first).
	moves: StockfishMove[];
	// true when analysis is complete (bestmove received or timeout).
	done: boolean;
}

// Streams Stockfish analysis results as an async generator, yielding a
// StockfishUpdate each time a new depth completes (all numMoves PVs received).
// The consumer can break out or call generator.return() at any time — the
// finally block ensures the Stockfish process is killed.
//
// Yields updates with done=false for intermediate depths, then a final
// update with done=true when bestmove arrives or the timeout fires.
// If the engine binary is unavailable, yields a single done=true with no moves.
export async function* streamTopMoves(
	fen: string,
	depth: number,
	numMoves: number,
	timeoutMs: number = DEFAULT_TIMEOUT_MS
): AsyncGenerator<StockfishUpdate> {
	// Simple async queue: stdout handler pushes items, the generator awaits them.
	const queue: StockfishUpdate[] = [];
	let waiting: ((value: void) => void) | null = null;
	const push = (item: StockfishUpdate) => {
		queue.push(item);
		if (waiting) {
			waiting();
			waiting = null;
		}
	};
	const pull = async (): Promise<StockfishUpdate> => {
		while (queue.length === 0) {
			await new Promise<void>((resolve) => {
				waiting = resolve;
			});
		}
		return queue.shift()!;
	};

	let proc: ReturnType<typeof spawn>;
	try {
		proc = spawn(STOCKFISH_BIN, [], {
			stdio: ['pipe', 'pipe', 'ignore']
		});
	} catch {
		console.warn(
			'[chessstack] Stockfish binary not found at %s — engine analysis unavailable.',
			STOCKFISH_BIN
		);
		yield { depth: 0, moves: [], done: true };
		return;
	}

	const stdin = proc.stdin!;
	const stdout = proc.stdout!;
	let finished = false;

	// Track results per depth. When all numMoves PVs arrive at a depth
	// higher than the last yielded depth, we push a snapshot.
	const currentDepth = new Map<number, StockfishMove>();
	let lastYieldedDepth = 0;
	let buffer = '';

	const finishWithPartial = () => {
		if (finished) return;
		finished = true;
		clearTimeout(timer);
		const sorted = [...currentDepth.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
		push({ depth: lastYieldedDepth, moves: sorted, done: true });
		proc.kill('SIGKILL');
	};

	const timer = setTimeout(finishWithPartial, timeoutMs);

	stdin.write(`uci\n`);
	stdin.write(`setoption name MultiPV value ${numMoves}\n`);
	stdin.write(`isready\n`);

	stdout.on('data', (chunk: Buffer) => {
		if (finished) return;
		buffer += chunk.toString();
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';

		for (const line of lines) {
			if (line.startsWith('readyok')) {
				stdin.write(`position fen ${fen}\n`);
				stdin.write(`go depth ${depth}\n`);
			} else if (line.startsWith('info') && line.includes('multipv') && line.includes(' pv ')) {
				const depthMatch = line.match(/depth (\d+)/);
				const multipvMatch = line.match(/multipv (\d+)/);
				const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
				if (!depthMatch || !multipvMatch || !pvMatch) continue;

				const infoDepth = parseInt(depthMatch[1], 10);
				const pvIdx = parseInt(multipvMatch[1], 10);
				const uci = pvMatch[1];
				const cpMatch = line.match(/score cp (-?\d+)/);
				const mateMatch = line.match(/score mate (-?\d+)/);

				currentDepth.set(pvIdx, {
					uci,
					scoreCp: cpMatch ? parseInt(cpMatch[1], 10) : null,
					scoreMate: mateMatch ? parseInt(mateMatch[1], 10) : null
				});

				// Stockfish emits multipv 1..N sequentially at each depth.
				// When we receive the last PV (pvIdx === numMoves) at a new
				// depth, push a snapshot.
				if (pvIdx >= numMoves && infoDepth > lastYieldedDepth) {
					lastYieldedDepth = infoDepth;
					const sorted = [...currentDepth.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
					push({ depth: infoDepth, moves: sorted, done: false });
				}
			} else if (line.startsWith('bestmove')) {
				finishWithPartial();
			}
		}
	});

	proc.on('error', (err) => {
		console.error('[chessstack] Stockfish process error:', err.message);
		if (!finished) {
			finished = true;
			clearTimeout(timer);
			push({ depth: 0, moves: [], done: true });
		}
	});

	proc.on('close', () => {
		if (!finished) {
			finished = true;
			clearTimeout(timer);
			const sorted = [...currentDepth.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
			push({ depth: lastYieldedDepth, moves: sorted, done: true });
		}
	});

	// Yield updates from the queue until we get a done=true item.
	try {
		while (true) {
			const update = await pull();
			yield update;
			if (update.done) return;
		}
	} finally {
		// Consumer broke out early (e.g. client disconnected) — clean up.
		if (!finished) {
			finished = true;
			clearTimeout(timer);
			proc.kill('SIGKILL');
		}
	}
}

// Asks Stockfish to analyse a position and return its top candidate moves.
//
// fen       — position to analyse, in FEN notation
// depth     — search depth in half-moves (higher = stronger but slower)
// numMoves  — how many candidates to return (controls the MultiPV setting)
// timeoutMs — how long to wait before returning partial results (user-configurable)
//
// Returns [] without throwing if the engine is unavailable.
export async function getTopMoves(
	fen: string,
	depth: number,
	numMoves: number,
	timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<StockfishMove[]> {
	return new Promise((resolve) => {
		// bestResults maps MultiPV index (1-based) → latest result for that PV.
		// We overwrite on every new "info" line so we always keep the deepest result.
		const bestResults = new Map<number, StockfishMove>();
		let buffer = '';
		let resolved = false;

		// Guard: ensure we only resolve once (timeout, bestmove, or process exit
		// can all race to resolve).
		const resolveOnce = (results: StockfishMove[]) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);
			resolve(results);
		};

		// Collect whatever results we have so far, kill the process, and resolve.
		const finish = () => {
			const sorted = [...bestResults.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
			resolveOnce(sorted);
			proc.kill('SIGKILL');
		};

		let proc: ReturnType<typeof spawn>;
		try {
			proc = spawn(STOCKFISH_BIN, [], {
				stdio: ['pipe', 'pipe', 'ignore']
			});
		} catch {
			// Binary not found (e.g. local dev without Stockfish installed).
			console.warn(
				'[chessstack] Stockfish binary not found at %s — engine analysis unavailable.',
				STOCKFISH_BIN
			);
			resolve([]);
			return;
		}

		// stdio: ['pipe', 'pipe', 'ignore'] guarantees stdin and stdout are non-null.
		const stdin = proc.stdin!;
		const stdout = proc.stdout!;

		// Safety net: if analysis takes too long, return partial results rather
		// than hanging the request indefinitely.
		const timer = setTimeout(finish, timeoutMs);

		// UCI handshake. stdin is available immediately after spawn — no "connect"
		// event needed. We set MultiPV before "isready" so the option is in place
		// before analysis begins.
		stdin.write(`uci\n`);
		stdin.write(`setoption name MultiPV value ${numMoves}\n`);
		stdin.write(`isready\n`);

		stdout.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();

			// Split on newlines. lines.pop() removes the last (potentially incomplete)
			// line and puts it back in the buffer for the next data event.
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				if (line.startsWith('readyok')) {
					// Engine is warmed up — send the position and kick off analysis.
					stdin.write(`position fen ${fen}\n`);
					stdin.write(`go depth ${depth}\n`);
				} else if (line.startsWith('info') && line.includes('multipv') && line.includes(' pv ')) {
					// Example "info" line:
					//   info depth 15 seldepth 22 multipv 1 score cp 45 nodes 1234 pv e2e4 e7e5 ...
					//   info depth 12 seldepth 14 multipv 2 score mate 3 nodes 5678 pv d1h5 ...
					//
					// We extract: multipv index, score (cp or mate), first move of the pv.
					const multipvMatch = line.match(/multipv (\d+)/);
					const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
					if (!multipvMatch || !pvMatch) continue;

					const pvIdx = parseInt(multipvMatch[1], 10);
					const uci = pvMatch[1];

					const cpMatch = line.match(/score cp (-?\d+)/);
					const mateMatch = line.match(/score mate (-?\d+)/);

					bestResults.set(pvIdx, {
						uci,
						scoreCp: cpMatch ? parseInt(cpMatch[1], 10) : null,
						scoreMate: mateMatch ? parseInt(mateMatch[1], 10) : null
					});
				} else if (line.startsWith('bestmove')) {
					// "bestmove" signals that Stockfish has finished. Return what we have.
					finish();
				}
			}
		});

		// If the binary is not found or crashes, resolve with an empty array
		// instead of letting the request hang or throw an unhandled error.
		proc.on('error', (err) => {
			console.error('[chessstack] Stockfish process error:', err.message);
			resolveOnce([]);
		});

		// If the process exits before bestmove (unexpected), resolve with
		// whatever partial results we have.
		proc.on('close', () => {
			const sorted = [...bestResults.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
			resolveOnce(sorted);
		});
	});
}
