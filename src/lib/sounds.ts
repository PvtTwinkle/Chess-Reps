/**
 * sounds.ts — centralised audio playback for the chess trainer.
 *
 * All four sound effects (move, capture, correct, incorrect) are preloaded
 * as Web Audio API AudioBuffers. This gives near-zero latency playback,
 * which matters for move sounds that should sync with piece animation.
 *
 * Usage:
 *   import { initSounds, setSoundEnabled, playMove, playCapture, playCorrect, playIncorrect } from '$lib/sounds';
 *
 *   // Call once when the app loads (or when the board page mounts).
 *   await initSounds();
 *
 *   // Reflect the user's saved preference.
 *   setSoundEnabled(data.settings?.soundEnabled ?? true);
 *
 *   // Then call play* wherever appropriate.
 *   playMove();
 *   playCapture();
 */

// ── Module-level state ─────────────────────────────────────────────────────

// Single AudioContext shared across all sounds. Browsers limit how many
// AudioContexts can be created, so we reuse one for the lifetime of the page.
// Created lazily on first use (browsers require a user gesture before audio).
let ctx: AudioContext | null = null;

// Decoded audio buffers keyed by sound name. Empty until initSounds() resolves.
const buffers = new Map<string, AudioBuffer>();

// Whether sounds should play at all. Controlled by setSoundEnabled().
let enabled = true;

// ── Internal helpers ───────────────────────────────────────────────────────

function getContext(): AudioContext {
	if (!ctx) ctx = new AudioContext();
	// Resume if the browser suspended the context (common on iOS/Safari).
	if (ctx.state === 'suspended') ctx.resume();
	return ctx;
}

async function loadBuffer(name: string, url: string): Promise<void> {
	try {
		const ac = getContext();
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const arrayBuffer = await response.arrayBuffer();
		const audioBuffer = await ac.decodeAudioData(arrayBuffer);
		buffers.set(name, audioBuffer);
	} catch (err) {
		// Fail silently — the app works fine without sounds.
		console.warn(`[sounds] Failed to load "${name}":`, err);
	}
}

function playBuffer(name: string, volume = 1): void {
	if (!enabled) return;
	const ac = getContext();
	const buffer = buffers.get(name);
	if (!buffer) return;

	const source = ac.createBufferSource();
	const gain = ac.createGain();
	source.buffer = buffer;
	source.connect(gain);
	gain.connect(ac.destination);
	gain.gain.value = volume;
	source.start();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Preload all four sound files. Call this once when the board page mounts.
 * Returns a promise that resolves when all files are loaded (or failed).
 * It is safe to call play* before this resolves — they simply no-op.
 */
export async function initSounds(): Promise<void> {
	await Promise.all([
		loadBuffer('move', '/sounds/move.mp3'),
		loadBuffer('capture', '/sounds/capture.mp3'),
		loadBuffer('correct', '/sounds/correct.mp3'),
		loadBuffer('incorrect', '/sounds/incorrect.mp3')
	]);
}

/** Enable or disable all sound effects (mirrors the user's saved setting). */
export function setSoundEnabled(value: boolean): void {
	enabled = value;
}

/** Play the piece-moves sound (no capture). */
export function playMove(): void {
	playBuffer('move', 0.8);
}

/** Play the piece-capture sound. */
export function playCapture(): void {
	playBuffer('capture', 0.8);
}

/** Play the "correct answer" notification sound. */
export function playCorrect(): void {
	playBuffer('correct', 0.7);
}

/** Play the "wrong answer" error sound. */
export function playIncorrect(): void {
	playBuffer('incorrect', 0.7);
}
