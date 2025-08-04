<script lang="ts">
	import { onMount } from 'svelte';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import {
		Plus,
		Trash2,
		Pencil,
		Save,
		X
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ipc from '../../ipc';

	// Anime providers extracted from download.js analysis
	const ANIME_PROVIDERS = [
		{ value: 'any', label: 'Any Provider' },
		{ value: 'Erai-raws', label: 'Erai-raws' },
		{ value: 'SubsPlease', label: 'SubsPlease' },
		{ value: 'New-raws', label: 'New-raws' },
		{ value: 'ToonsHub', label: 'ToonsHub' }
	];

	let whitelist = $state<any[]>([]);
	let loading = $state(true);
	let showAddForm = $state(false);
	let editingId = $state<number | null>(null);

	let newEntry = $state({
		title: '',
		keywords: '',
		exclude_keywords: '',
		quality: '1080p',
		group: 'any',
		enabled: true
	});

	onMount(async () => {
		await loadWhitelist();
	});

	async function loadWhitelist() {
		try {
			whitelist = await ipc.getWhitelist();
		} catch (error: any) {
			console.error('Error loading whitelist:', error);
			toast.error('Failed to load whitelist', {
				description: `Error loading whitelist: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			loading = false;
		}
	}

	async function addEntry() {
		try {
			// Create a plain object to avoid Svelte reactivity issues
			const entryData = {
				title: newEntry.title,
				keywords: newEntry.keywords,
				exclude_keywords: newEntry.exclude_keywords,
				quality: newEntry.quality,
				group: newEntry.group,
				enabled: newEntry.enabled
			};

			await ipc.addWhitelistEntry(entryData);
			newEntry = {
				title: '',
				keywords: '',
				exclude_keywords: '',
				quality: '1080p',
				group: 'any',
				enabled: true
			};
			showAddForm = false;
			await loadWhitelist();
			toast.success('Whitelist entry added', {
				description: 'New anime has been added to the whitelist.',
				duration: 4000
			});
		} catch (error: any) {
			console.error('Error adding whitelist entry:', error);
			toast.error('Failed to add entry', {
				description: `Error adding whitelist entry: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function updateEntry(id: number, entry: any) {
		try {
			// Create a plain object to avoid Svelte reactivity issues
			const entryData = {
				title: entry.title,
				keywords: entry.keywords,
				exclude_keywords: entry.exclude_keywords,
				quality: entry.quality,
				group: entry.group || entry.preferred_group,
				enabled: entry.enabled
			};

			await ipc.updateWhitelistEntry(id, entryData);
			editingId = null;
			await loadWhitelist();
			toast.success('Entry updated', {
				description: 'Whitelist entry has been updated.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error updating whitelist entry:', error);
			toast.error('Failed to update entry', {
				description: `Error updating entry: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function removeEntry(id: number) {
		try {
			await ipc.removeWhitelistEntry(id);
			await loadWhitelist();
			toast.success('Entry removed', {
				description: 'Whitelist entry has been removed.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error removing whitelist entry:', error);
			toast.error('Failed to remove entry', {
				description: `Error removing entry: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function toggleEntry(id: number, enabled: boolean) {
		try {
			await ipc.toggleWhitelistEntry(id, enabled);
			await loadWhitelist();
			toast.success(`Entry ${enabled ? 'enabled' : 'disabled'}`, {
				description: `Whitelist entry has been ${enabled ? 'enabled' : 'disabled'}.`,
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error toggling whitelist entry:', error);
			toast.error('Failed to toggle entry', {
				description: `Error toggling entry: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	function startEditing(id: number) {
		editingId = id;
	}

	function cancelEditing() {
		editingId = null;
	}
</script>

<div class="p-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Whitelist</h1>
			<p class="text-muted-foreground">Manage anime titles to automatically download</p>
		</div>
		<Button onclick={() => showAddForm = !showAddForm}>
			<Plus class="w-4 h-4 mr-2" />
			Add Entry
		</Button>
	</div>

	{#if showAddForm}
		<Card class="mb-6">
			<CardHeader>
				<CardTitle>Add New Whitelist Entry</CardTitle>
				<CardDescription>Configure automatic download settings for an anime series</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div>
					<Label for="title">Title</Label>
					<Input id="title" bind:value={newEntry.title} placeholder="Anime title" />
				</div>
				<div>
					<Label for="keywords">Keywords (comma separated)</Label>
					<Input id="keywords" bind:value={newEntry.keywords} placeholder="keyword1, keyword2" />
				</div>
				<div>
					<Label for="exclude">Exclude Keywords (comma separated)</Label>
					<Input id="exclude" bind:value={newEntry.exclude_keywords} placeholder="exclude1, exclude2" />
				</div>
				<div>
					<Label for="quality">Preferred Quality</Label>
					<select id="quality" bind:value={newEntry.quality} class="w-full p-2 border rounded">
						<option value="1080p">1080p</option>
						<option value="720p">720p</option>
						<option value="480p">480p</option>
						<option value="any">Any</option>
					</select>
				</div>
				<div>
					<Label for="provider">Preferred Provider</Label>
					<select id="provider" bind:value={newEntry.group} class="w-full p-2 border rounded">
						{#each ANIME_PROVIDERS as provider}
							<option value={provider.value}>{provider.label}</option>
						{/each}
					</select>
					<p class="text-xs text-gray-500 mt-1">
						Choose which anime provider group you prefer. "Any Provider" will download from any available source.
					</p>
				</div>
				<div class="flex gap-2">
					<Button onclick={addEntry}>
						<Save class="w-4 h-4 mr-2" />
						Save Entry
					</Button>
					<Button variant="outline" onclick={() => showAddForm = false}>
						<X class="w-4 h-4 mr-2" />
						Cancel
					</Button>
				</div>
			</CardContent>
		</Card>
	{/if}

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
		</div>
	{:else if whitelist.length === 0}
		<Card>
			<CardContent class="text-center py-12">
				<Plus class="w-12 h-12 text-muted-foreground mx-auto mb-4" />
				<h3 class="text-lg font-semibold mb-2">No whitelist entries</h3>
				<p class="text-muted-foreground">Add anime titles to automatically download new episodes</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each whitelist as entry}
				<Card>
					<CardContent class="p-4">
						{#if editingId === entry.id}
							<!-- Edit mode -->
							<div class="space-y-4">
								<Input bind:value={entry.title} placeholder="Title" />
								<Input bind:value={entry.keywords} placeholder="Keywords" />
								<Input bind:value={entry.exclude_keywords} placeholder="Exclude keywords" />
								<select bind:value={entry.quality} class="w-full p-2 border rounded">
									<option value="1080p">1080p</option>
									<option value="720p">720p</option>
									<option value="480p">480p</option>
									<option value="any">Any</option>
								</select>
								<select bind:value={entry.group} class="w-full p-2 border rounded">
									{#each ANIME_PROVIDERS as provider}
										<option value={provider.value}>{provider.label}</option>
									{/each}
								</select>
								<div class="flex gap-2">
									<Button size="sm" onclick={() => updateEntry(entry.id, entry)}>
										<Save class="w-4 h-4 mr-2" />
										Save
									</Button>
									<Button size="sm" variant="outline" onclick={cancelEditing}>
										<X class="w-4 h-4 mr-2" />
										Cancel
									</Button>
								</div>
							</div>
						{:else}
							<!-- View mode -->
							<div class="flex items-center justify-between">
								<div class="flex-1">
									<h3 class="font-medium {!entry.enabled ? 'text-muted-foreground line-through' : ''}">
										{entry.title}
									</h3>
									<p class="text-sm text-muted-foreground">
										Keywords: {entry.keywords || 'None'}
									</p>
									{#if entry.exclude_keywords}
										<p class="text-sm text-muted-foreground">
											Exclude: {entry.exclude_keywords}
										</p>
									{/if}
									<p class="text-sm text-muted-foreground">
										Quality: {entry.quality}
									</p>
									<p class="text-sm text-muted-foreground">
										Provider: {ANIME_PROVIDERS.find(p => p.value === entry.group)?.label || entry.group || 'Any Provider'}
									</p>
								</div>
								<div class="flex items-center gap-4">
									<div class="flex items-center gap-3">
										<Switch
											checked={entry.enabled}
											onCheckedChange={(checked) => toggleEntry(entry.id, checked)}
										/>
										<Label class="text-sm font-medium">
											{entry.enabled ? 'Enabled' : 'Disabled'}
										</Label>
									</div>
									<div class="flex items-center gap-2">
										<Button
											size="sm"
											variant="ghost"
											class="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
											onclick={() => startEditing(entry.id)}
										>
											<Pencil class="w-4 h-4" />
										</Button>
										<Button
											size="sm"
											variant="ghost"
											class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
											onclick={() => removeEntry(entry.id)}
										>
											<Trash2 class="w-4 h-4" />
										</Button>
									</div>
								</div>
							</div>
						{/if}
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
