<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { AlertTriangle } from 'lucide-svelte';

	let { 
		open = $bindable(false),
		title = 'Confirm Action',
		description = 'Are you sure you want to proceed?',
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		variant = 'destructive' as 'destructive' | 'default',
		onConfirm = () => {},
		onCancel = () => {}
	} = $props();

	function handleConfirm() {
		onConfirm();
		open = false;
	}

	function handleCancel() {
		onCancel();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<div class="flex items-center gap-3">
				{#if variant === 'destructive'}
					<AlertTriangle class="w-5 h-5 text-destructive" />
				{/if}
				<Dialog.Title>{title}</Dialog.Title>
			</div>
			<Dialog.Description class="text-left">
				{description}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={handleCancel}>
				{cancelText}
			</Button>
			<Button variant={variant} onclick={handleConfirm}>
				{confirmText}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
