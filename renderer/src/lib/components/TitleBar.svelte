<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Minus, Square, X, Copy } from 'lucide-svelte';
	import ipc from '../../ipc';

	let isMaximized = $state(false);

	onMount(async () => {
		// Check initial maximized state
		isMaximized = await ipc.windowIsMaximized();
	});

	async function minimizeWindow() {
		await ipc.windowMinimize();
	}

	async function maximizeWindow() {
		await ipc.windowMaximize();
		isMaximized = await ipc.windowIsMaximized();
	}

	async function closeWindow() {
		await ipc.windowClose();
	}
</script>

<div class="flex items-center justify-between h-8 bg-card border-b border-border select-none" style="-webkit-app-region: drag;">
	<!-- Left side - App title -->
	<div class="flex items-center px-4">
		<h1 class="text-sm font-semibold text-foreground">MoeDownloader</h1>
	</div>

	<!-- Right side - Window controls -->
	<div class="flex items-center" style="-webkit-app-region: no-drag;">
		<Button
			variant="ghost"
			size="sm"
			class="h-8 w-8 p-0 hover:bg-muted rounded-none"
			onclick={minimizeWindow}
			aria-label="Minimize"
		>
			<Minus class="w-4 h-4" />
		</Button>

		<Button
			variant="ghost"
			size="sm"
			class="h-8 w-8 p-0 hover:bg-muted rounded-none"
			onclick={maximizeWindow}
			aria-label={isMaximized ? "Restore" : "Maximize"}
		>
			{#if isMaximized}
				<Copy class="w-3 h-3" />
			{:else}
				<Square class="w-3 h-3" />
			{/if}
		</Button>

		<Button
			variant="ghost"
			size="sm"
			class="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground rounded-none"
			onclick={closeWindow}
			aria-label="Close"
		>
			<X class="w-4 h-4" />
		</Button>
	</div>
</div>
