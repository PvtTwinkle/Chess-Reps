// Shared writable store for the current tutorial step.
// Synced from data.settings.tutorialStep in the root layout.
// Pages (build, drill) subscribe to trigger tutorial-specific behavior.
//
// null  = tutorial completed or skipped (no overlay shown)
// 0–6   = active tutorial step

import { writable } from 'svelte/store';

export const tutorialStep = writable<number | null>(null);
