// Tutorial step definitions.
//
// Each step describes what the user sees and how they advance.
// Steps with autoAdvance = true are advanced by page-level code
// (e.g. after moves are played or cards are graded), not by a button.

export interface TutorialStepDef {
	id: number;
	page: string; // expected pathname prefix
	title: string;
	body: string;
	nextLabel?: string; // button text (omitted for auto-advance steps)
	navTo?: string; // if set, next/button navigates here
	autoAdvance?: boolean; // step advances by code, not by button click
}

export const TUTORIAL_STEPS: TutorialStepDef[] = [
	// Step 0 is handled by OnboardingWelcome — no overlay needed
	{
		id: 0,
		page: '/',
		title: 'Welcome',
		body: '',
		autoAdvance: true
	},
	{
		id: 1,
		page: '/build',
		title: 'Build Your Repertoire',
		body: 'Play moves on the board to build your opening repertoire — drag a piece or click to move. Each move saves automatically. Use the suggestion tabs on the right (Book, Masters, Engine) to explore candidate moves. Play 8 moves to continue.',
		autoAdvance: true
	},
	{
		id: 2,
		page: '/build',
		title: "You're Off to a Great Start!",
		body: "You've built the beginning of your repertoire. Now let's practice these moves with spaced repetition.",
		nextLabel: 'Go to Drill',
		navTo: '/drill'
	},
	{
		id: 3,
		page: '/drill',
		title: 'Drill Mode',
		body: 'The board will replay your opening line, then pause at your turn. Play the correct move from memory. After each card, grade yourself: Again, Good, or Easy. Try a few cards now!',
		autoAdvance: true
	},
	{
		id: 4,
		page: '/puzzles',
		title: 'Puzzle Training',
		body: 'Sharpen your tactics with puzzles filtered to your repertoire openings. Use the sidebar filters to narrow by opening, rating, or theme.',
		nextLabel: 'Continue',
		navTo: '/review'
	},
	{
		id: 5,
		page: '/review',
		title: 'Game Review',
		body: 'After playing a game, paste the PGN here or import from Lichess/Chess.com. The app highlights where you deviated from your repertoire.',
		nextLabel: 'Finish Tutorial'
	}
];

export const TOTAL_STEPS = TUTORIAL_STEPS.length;
