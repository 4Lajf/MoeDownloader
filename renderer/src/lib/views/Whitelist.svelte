<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import { Plus, Trash2, Pencil, Save, X } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ipc from '../../ipc';

	// Quality options
	const QUALITY_OPTIONS = [
		{ value: '1080p', label: '1080p' },
		{ value: '720p', label: '720p' },
		{ value: '480p', label: '480p' },
		{ value: 'any', label: 'Any' }
	];

	// Anime providers - only these groups are allowed for downloads
	const ANIME_PROVIDERS = [
		{ value: 'any', label: 'Any Allowed Provider' },
		{ value: 'Erai-raws', label: 'Erai-raws' },
		{ value: 'SubsPlease', label: 'SubsPlease' },
		{ value: 'New-raws', label: 'New-raws' },
		{ value: 'ASW', label: 'ASW' }
	];

	let whitelist = $state<any[]>([]);
	let manualEntries = $state<any[]>([]);
	let autoSyncedEntries = $state<any[]>([]);
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
			loading = true;
			whitelist = await ipc.getWhitelist();

			// Separate manual and auto-synced entries
			manualEntries = whitelist.filter(
				(entry) => entry.source_type !== 'anilist' || !entry.auto_sync
			);
			autoSyncedEntries = whitelist.filter(
				(entry) => entry.source_type === 'anilist' && entry.auto_sync
			);
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
		<Button variant="success" onclick={() => (showAddForm = !showAddForm)}>
			<Plus class="mr-2 h-4 w-4" />
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
					<Input
						id="exclude"
						bind:value={newEntry.exclude_keywords}
						placeholder="exclude1, exclude2"
					/>
				</div>
				<div>
					<Label for="quality">Preferred Quality</Label>
					<Select
						type="single"
						value={newEntry.quality}
						onValueChange={(value) => (newEntry.quality = value || '1080p')}
					>
						<SelectTrigger class="w-full">
							{QUALITY_OPTIONS.find((q) => q.value === newEntry.quality)?.label || 'Select quality'}
						</SelectTrigger>
						<SelectContent>
							{#each QUALITY_OPTIONS as quality (quality.value)}
								<SelectItem value={quality.value}>
									{quality.label}
								</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
				<div>
					<Label for="provider">Preferred Provider</Label>
					<Select
						type="single"
						value={newEntry.group}
						onValueChange={(value) => (newEntry.group = value || 'any')}
					>
						<SelectTrigger class="w-full">
							{ANIME_PROVIDERS.find((p) => p.value === newEntry.group)?.label || 'Select provider'}
						</SelectTrigger>
						<SelectContent>
							{#each ANIME_PROVIDERS as provider (provider.value)}
								<SelectItem value={provider.value}>
									{provider.label}
								</SelectItem>
							{/each}
						</SelectContent>
					</Select>
					<p class="mt-1 text-xs text-gray-500">
						Choose which anime provider group you prefer. "Any Provider" will download from any
						available source.
					</p>
				</div>
				<div class="flex gap-2">
					<Button variant="success" onclick={addEntry}>
						<Save class="mr-2 h-4 w-4" />
						Save Entry
					</Button>
					<Button variant="outline" onclick={() => (showAddForm = false)}>
						<X class="mr-2 h-4 w-4" />
						Cancel
					</Button>
				</div>
			</CardContent>
		</Card>
	{/if}

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<div class="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
		</div>
	{:else if manualEntries.length === 0 && autoSyncedEntries.length === 0}
		<Card>
			<CardContent class="py-12 text-center">
				<Plus class="text-muted-foreground mx-auto mb-4 h-12 w-12" />
				<h3 class="mb-2 text-lg font-semibold">No whitelist entries</h3>
				<p class="text-muted-foreground">Add anime titles to automatically download new episodes</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-6">
			<!-- Manual Entries Section -->
			{#if manualEntries.length > 0}
				<div class="space-y-4">
					<h2 class="text-xl font-semibold">Manual Entries</h2>
					{#each manualEntries as entry}
						<Card>
							<CardContent class="p-4">
								{#if editingId === entry.id}
									<!-- Edit mode -->
									<div class="space-y-4">
										<Input bind:value={entry.title} placeholder="Title" />
										<Input bind:value={entry.keywords} placeholder="Keywords" />
										<Input bind:value={entry.exclude_keywords} placeholder="Exclude keywords" />
										<Select
											type="single"
											value={entry.quality}
											onValueChange={(value) => (entry.quality = value || '1080p')}
										>
											<SelectTrigger class="w-full">
												{QUALITY_OPTIONS.find((q) => q.value === entry.quality)?.label ||
													'Select quality'}
											</SelectTrigger>
											<SelectContent>
												{#each QUALITY_OPTIONS as quality (quality.value)}
													<SelectItem value={quality.value}>
														{quality.label}
													</SelectItem>
												{/each}
											</SelectContent>
										</Select>
										<Select
											type="single"
											value={entry.group}
											onValueChange={(value) => (entry.group = value || 'any')}
										>
											<SelectTrigger class="w-full">
												{ANIME_PROVIDERS.find((p) => p.value === entry.group)?.label ||
													'Select provider'}
											</SelectTrigger>
											<SelectContent>
												{#each ANIME_PROVIDERS as provider (provider.value)}
													<SelectItem value={provider.value}>
														{provider.label}
													</SelectItem>
												{/each}
											</SelectContent>
										</Select>
										<div class="flex gap-2">
											<Button
												size="sm"
												variant="success"
												onclick={() => updateEntry(entry.id, entry)}
											>
												<Save class="mr-2 h-4 w-4" />
												Save
											</Button>
											<Button size="sm" variant="outline" onclick={cancelEditing}>
												<X class="mr-2 h-4 w-4" />
												Cancel
											</Button>
										</div>
									</div>
								{:else}
									<!-- View mode -->
									<div class="flex items-center justify-between">
										<div class="flex-1">
											<h3
												class="font-medium {!entry.enabled
													? 'text-muted-foreground line-through'
													: ''}"
											>
												{entry.title}
											</h3>
											<p class="text-muted-foreground text-sm">
												Keywords: {entry.keywords || 'None'}
											</p>
											{#if entry.exclude_keywords}
												<p class="text-muted-foreground text-sm">
													Exclude: {entry.exclude_keywords}
												</p>
											{/if}
											<p class="text-muted-foreground text-sm">
												Quality: {entry.quality}
											</p>
											<p class="text-muted-foreground text-sm">
												Provider: {ANIME_PROVIDERS.find((p) => p.value === entry.group)?.label ||
													entry.group ||
													'Any Provider'}
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
													class="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
													onclick={() => startEditing(entry.id)}
												>
													<Pencil class="h-4 w-4" />
												</Button>
												<Button
													size="sm"
													variant="ghost"
													class="text-muted-foreground h-8 w-8 p-0 transition-all duration-200 hover:bg-red-700/10 hover:text-red-700 dark:hover:bg-red-600/10 dark:hover:text-red-300"
													onclick={() => removeEntry(entry.id)}
												>
													<Trash2 class="h-4 w-4" />
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

			<!-- Auto-Synced Entries Section -->
			{#if autoSyncedEntries.length > 0}
				<div class="space-y-4">
					<div class="flex items-center gap-2">
						<h2 class="text-xl font-semibold">AniList Auto-Sync</h2>
						<Badge variant="secondary" class="text-xs">
							{autoSyncedEntries.length} entries
						</Badge>
					</div>
					<p class="text-muted-foreground text-sm">
						These entries are automatically synchronized from your AniList account. Titles cannot be
						edited, but you can modify quality and sub group preferences.
					</p>
					{#each autoSyncedEntries as entry}
						<Card class="border-l-4 border-l-purple-500">
							<CardContent class="p-4">
								{#if editingId === entry.id}
									<!-- Edit mode for auto-synced entries (limited) -->
									<div class="space-y-4">
										<!-- Title is disabled for auto-synced entries -->
										<div>
											<Label>Title (Auto-synced from AniList)</Label>
											<Input value={entry.title} disabled class="bg-muted" />
										</div>
										<div>
											<Label>Keywords (Auto-synced from AniList)</Label>
											<Input value={entry.keywords || 'None'} disabled class="bg-muted" />
										</div>
										<div>
											<Label>Exclude Keywords (Auto-synced from AniList)</Label>
											<Input value={entry.exclude_keywords || 'None'} disabled class="bg-muted" />
										</div>
										<Select
											type="single"
											value={entry.quality}
											onValueChange={(value) => (entry.quality = value || '1080p')}
										>
											<SelectTrigger class="w-full">
												{QUALITY_OPTIONS.find((q) => q.value === entry.quality)?.label ||
													'Select quality'}
											</SelectTrigger>
											<SelectContent>
												{#each QUALITY_OPTIONS as quality (quality.value)}
													<SelectItem value={quality.value}>
														{quality.label}
													</SelectItem>
												{/each}
											</SelectContent>
										</Select>
										<Select
											type="single"
											value={entry.group}
											onValueChange={(value) => (entry.group = value || 'any')}
										>
											<SelectTrigger class="w-full">
												{ANIME_PROVIDERS.find((p) => p.value === entry.group)?.label ||
													'Select provider'}
											</SelectTrigger>
											<SelectContent>
												{#each ANIME_PROVIDERS as provider (provider.value)}
													<SelectItem value={provider.value}>
														{provider.label}
													</SelectItem>
												{/each}
											</SelectContent>
										</Select>
										<div class="flex gap-2">
											<Button
												size="sm"
												variant="success"
												onclick={() => updateEntry(entry.id, entry)}
											>
												<Save class="mr-2 h-4 w-4" />
												Save
											</Button>
											<Button size="sm" variant="outline" onclick={cancelEditing}>
												<X class="mr-2 h-4 w-4" />
												Cancel
											</Button>
										</div>
									</div>
								{:else}
									<!-- View mode for auto-synced entries -->
									<div class="flex items-center justify-between">
										<div class="flex-1">
											<div class="flex items-center gap-2">
												<h3
													class="font-medium {!entry.enabled
														? 'text-muted-foreground line-through'
														: ''}"
												>
													{entry.title}
												</h3>
												<Badge variant="outline" class="text-xs">AniList</Badge>
											</div>
											<p class="text-muted-foreground text-sm">
												Keywords: {entry.keywords || 'Auto-generated'}
											</p>
											{#if entry.exclude_keywords}
												<p class="text-muted-foreground text-sm">
													Exclude: {entry.exclude_keywords}
												</p>
											{/if}
											{#if entry.title_romaji || entry.title_english || entry.title_synonyms}
												<div class="text-muted-foreground mt-1 text-xs">
													<span class="font-medium">Alternative titles:</span>
													{#if entry.title_romaji && entry.title_romaji !== entry.title}
														<span class="bg-muted mr-1 inline-block rounded px-1 py-0.5"
															>Romaji: {entry.title_romaji}</span
														>
													{/if}
													{#if entry.title_english && entry.title_english !== entry.title}
														<span class="bg-muted mr-1 inline-block rounded px-1 py-0.5"
															>English: {entry.title_english}</span
														>
													{/if}
													{#if entry.title_synonyms}
														{@const synonyms =
															typeof entry.title_synonyms === 'string'
																? JSON.parse(entry.title_synonyms)
																: entry.title_synonyms}
														{#if Array.isArray(synonyms) && synonyms.length > 0}
															{#each synonyms as synonym}
																{#if synonym && synonym !== entry.title && synonym !== entry.title_romaji && synonym !== entry.title_english && /^[a-zA-Z0-9\s\-:!?.,'"()&]+$/.test(synonym)}
																	<span class="bg-muted mr-1 inline-block rounded px-1 py-0.5"
																		>Synonym: {synonym}</span
																	>
																{/if}
															{/each}
														{/if}
													{/if}
												</div>
											{/if}
											<p class="text-muted-foreground text-sm">
												Quality: {entry.quality}
											</p>
											<p class="text-muted-foreground text-sm">
												Provider: {ANIME_PROVIDERS.find((p) => p.value === entry.group)?.label ||
													entry.group ||
													'Any Provider'}
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
													class="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
													onclick={() => startEditing(entry.id)}
													title="Edit quality and sub group preferences"
												>
													<Pencil class="h-4 w-4" />
												</Button>
												<Button
													size="sm"
													variant="ghost"
													class="text-muted-foreground h-8 w-8 p-0 transition-all duration-200 hover:bg-red-700/10 hover:text-red-700 dark:hover:bg-red-600/10 dark:hover:text-red-300"
													onclick={() => removeEntry(entry.id)}
													title="Remove from whitelist (will be re-added on next sync)"
												>
													<Trash2 class="h-4 w-4" />
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
	{/if}
</div>
