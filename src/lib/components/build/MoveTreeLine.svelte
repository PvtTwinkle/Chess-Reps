<script module lang="ts">
	export interface TreeNode {
		san: string;
		fromFen: string;
		toFen: string;
		toFenKey: string; // pre-computed fenKey(toFen)
		ply: number;
		children: TreeNode[];
		pathSans: string[]; // full path from STARTING_FEN for navigation
	}
</script>

<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import MoveTreeLine from './MoveTreeLine.svelte';

	interface Props {
		node: TreeNode;
		currentFenKey: string;
		expanded: SvelteSet<string>;
		onToggle: (branchKey: string) => void;
		onNavigateToLine: (sans: string[]) => void;
		isFirstInBranch?: boolean;
	}

	let {
		node,
		currentFenKey,
		expanded,
		onToggle,
		onNavigateToLine,
		isFirstInBranch = false
	}: Props = $props();

	// Walk the mainline: follow first child at each level
	const mainline = $derived.by(() => {
		const nodes: TreeNode[] = [];
		let current: TreeNode | undefined = node;
		while (current) {
			nodes.push(current);
			current = current.children[0];
		}
		return nodes;
	});

	function needsMoveNumber(n: TreeNode, idx: number): boolean {
		// White always gets a number
		if (n.ply % 2 === 1) return true;
		// Black gets a number only at the start of a branch
		if (idx === 0 && isFirstInBranch) return true;
		return false;
	}

	function moveNumber(ply: number): string {
		const num = Math.ceil(ply / 2);
		if (ply % 2 === 1) return `${num}.`;
		return `${num}...`;
	}

	function branchKey(parentToFenKey: string, branchSan: string): string {
		return `${parentToFenKey}|${branchSan}`;
	}
</script>

<span class="tree-line">
	{#each mainline as n, idx (n.toFenKey)}
		{#if needsMoveNumber(n, idx)}
			<span class="tree-num">{moveNumber(n.ply)}</span>
		{/if}
		<button
			class="tree-san"
			class:is-current={n.toFenKey === currentFenKey}
			onclick={() => onNavigateToLine(n.pathSans)}>{n.san}</button
		>
		{#if n.children.length > 1}
			{#each n.children.slice(1) as branch (branch.toFenKey)}
				{@const bk = branchKey(n.toFenKey, branch.san)}
				<button class="branch-toggle" onclick={() => onToggle(bk)}
					>{expanded.has(bk) ? '▾' : '▸'}</button
				>
				{#if expanded.has(bk)}
					<div class="branch-indent">
						<MoveTreeLine
							node={branch}
							{currentFenKey}
							{expanded}
							{onToggle}
							{onNavigateToLine}
							isFirstInBranch={true}
						/>
					</div>
				{/if}
			{/each}
		{/if}
	{/each}
</span>

<style>
	.tree-line {
		display: inline;
	}

	.tree-num {
		color: #505060;
		font-size: 0.75rem;
		user-select: none;
		margin-right: 0.1rem;
	}

	.tree-san {
		background: none;
		border: none;
		color: #c0c0d0;
		font-size: 0.82rem;
		cursor: pointer;
		padding: 0.05rem 0.2rem;
		border-radius: 2px;
		font-family: inherit;
		transition:
			background 0.12s,
			color 0.12s;
	}

	.tree-san:hover {
		background: #0f3460;
		color: #f0f0f0;
	}

	.tree-san.is-current {
		background: #1a4a7a;
		color: #e2b714;
		font-weight: 600;
	}

	.branch-toggle {
		background: none;
		border: none;
		color: #505060;
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0 0.15rem;
		font-family: inherit;
		transition: color 0.12s;
	}

	.branch-toggle:hover {
		color: #e2b714;
	}

	.branch-indent {
		display: block;
		margin-left: 1rem;
		padding-left: 0.5rem;
		border-left: 1px solid #1a3a5c;
	}
</style>
