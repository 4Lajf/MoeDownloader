<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import {
		Trash2,
		RefreshCw,
		Search,
		Download,
		Calendar,
		Film,
		Database
	} from 'lucide-svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ipc from '../../ipc';

	let processedFiles = $state<any[]>([]);
	let filteredFiles = $state<any[]>([]);
	let isLoading = $state(false);
	let searchQuery = $state('');
	let selectedWhitelistEntry = $state('');
	let whitelistEntries = $state<any[]>([]);
	let processedGuidsCount = $state(0);

	// Confirmation dialog state
	let confirmDialog = $state({
		open: false,
		title: '',
		description: '',
		onConfirm: () => {}
	});

	// Statistics
	let stats = {
		totalFiles: 0,
		uniqueAnime: 0,
		totalEpisodes: 0,
		lastProcessed: null
	};

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		try {
			isLoading = true;
			
			// Load processed files
			processedFiles = await ipc.getProcessedFiles();

			// Load whitelist entries for filtering
			whitelistEntries = await ipc.getWhitelist();

			// Load processed GUIDs count
			processedGuidsCount = await ipc.getProcessedGuidsCount();

			// Calculate statistics
			calculateStats();
			
			// Apply current filters
			applyFilters();
			
		} catch (error: any) {
			console.error('Error loading database data:', error);
			toast.error('Failed to load data', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			isLoading = false;
		}
	}

	function calculateStats() {
		stats.totalFiles = processedFiles.length;
		stats.uniqueAnime = new Set(processedFiles.map(f => f.anime_title)).size;
		stats.totalEpisodes = processedFiles.filter(f => f.episode_number).length;
		
		if (processedFiles.length > 0) {
			const latest = processedFiles.reduce((latest, file) => 
				new Date(file.processed_at) > new Date(latest.processed_at) ? file : latest
			);
			stats.lastProcessed = latest.processed_at;
		}
	}

	function applyFilters() {
		filteredFiles = processedFiles.filter(file => {
			const matchesSearch = !searchQuery || 
				file.anime_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
				file.final_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
				file.original_filename.toLowerCase().includes(searchQuery.toLowerCase());
			
			const matchesWhitelist = !selectedWhitelistEntry || 
				file.whitelist_entry_id.toString() === selectedWhitelistEntry;
			
			return matchesSearch && matchesWhitelist;
		});
	}

	function confirmDeleteProcessedFile(id: number) {
		confirmDialog = {
			open: true,
			title: 'Delete Processed File',
			description: 'Are you sure you want to delete this processed file record? This will allow it to be downloaded again.',
			onConfirm: () => deleteProcessedFile(id)
		};
	}

	async function deleteProcessedFile(id: number) {
		try {
			await ipc.deleteProcessedFile(id);
			toast.success('Processed file deleted', {
				description: 'The file can now be downloaded again.',
				duration: 3000
			});
			await loadData();
		} catch (error: any) {
			console.error('Error deleting processed file:', error);
			toast.error('Failed to delete file', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	function confirmClearAllProcessedFiles() {
		confirmDialog = {
			open: true,
			title: 'Clear All Processed Files',
			description: 'Are you sure you want to clear ALL processed file records? This will allow all files to be downloaded again.',
			onConfirm: () => clearAllProcessedFiles()
		};
	}

	async function clearAllProcessedFiles() {
		try {
			await ipc.clearAllProcessedFiles();
			toast.success('All processed files cleared', {
				description: 'All files can now be downloaded again.',
				duration: 3000
			});
			await loadData();
		} catch (error: any) {
			console.error('Error clearing processed files:', error);
			toast.error('Failed to clear files', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	function confirmClearByWhitelistEntry(whitelistEntryId: number) {
		const entry = whitelistEntries.find(e => e.id === whitelistEntryId);
		confirmDialog = {
			open: true,
			title: 'Clear Processed Files',
			description: `Are you sure you want to clear all processed files for "${entry?.title}"? This will allow all episodes to be downloaded again.`,
			onConfirm: () => clearByWhitelistEntry(whitelistEntryId)
		};
	}

	async function clearByWhitelistEntry(whitelistEntryId: number) {
		const entry = whitelistEntries.find(e => e.id === whitelistEntryId);
		try {
			await ipc.clearProcessedFilesByWhitelistEntry(whitelistEntryId);
			toast.success('Processed files cleared', {
				description: `All episodes for "${entry?.title}" can now be downloaded again.`,
				duration: 3000
			});
			await loadData();
		} catch (error: any) {
			console.error('Error clearing processed files:', error);
			toast.error('Failed to clear files', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function debugProcessedFiles() {
		try {
			const debugData = await ipc.debugProcessedFiles();
			console.log('🐛 DEBUG: Processed files debug data:', debugData);
			toast.success('Debug data logged', {
				description: `Found ${debugData.length} processed files. Check console for details.`,
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error getting debug data:', error);
			toast.error('Debug failed', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	function confirmClearProcessedGuids() {
		confirmDialog = {
			open: true,
			title: 'Clear Processed GUIDs',
			description: 'Are you sure you want to clear all processed RSS GUIDs? This will allow all RSS items to be processed again.',
			onConfirm: () => clearProcessedGuids()
		};
	}

	async function clearProcessedGuids() {
		try {
			await ipc.clearProcessedGuids();
			// Refresh the count after clearing
			processedGuidsCount = await ipc.getProcessedGuidsCount();
			toast.success('Processed GUIDs cleared', {
				description: 'All RSS items can now be processed again.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error clearing processed GUIDs:', error);
			toast.error('Failed to clear GUIDs', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	function formatDate(dateString: string) {
		return new Date(dateString).toLocaleString();
	}

	function getStatusBadgeVariant(status: string) {
		switch (status) {
			case 'completed': return 'default';
			case 'downloading': return 'secondary';
			case 'queued': return 'outline';
			case 'failed': return 'destructive';
			default: return 'outline';
		}
	}

	// Reactive effect for filtering
	$effect(() => {
		applyFilters();
	});
</script>

<div class="space-y-6 p-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Database Management</h1>
			<p class="text-muted-foreground">
				Manage processed files and download history
			</p>
		</div>
		<Button onclick={loadData} disabled={isLoading}>
			{#if isLoading}
				<RefreshCw class="w-4 h-4 mr-2 animate-spin" />
				Loading...
			{:else}
				<RefreshCw class="w-4 h-4 mr-2" />
				Refresh
			{/if}
		</Button>
	</div>

	<!-- Statistics Cards -->
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Total Files</CardTitle>
				<Database class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{stats.totalFiles}</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Unique Anime</CardTitle>
				<Film class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{stats.uniqueAnime}</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Episodes</CardTitle>
				<Download class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{stats.totalEpisodes}</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Last Processed</CardTitle>
				<Calendar class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-sm font-medium">
					{stats.lastProcessed ? formatDate(stats.lastProcessed) : 'Never'}
				</div>
			</CardContent>
		</Card>
	</div>

	<ConfirmDialog
		bind:open={confirmDialog.open}
		title={confirmDialog.title}
		description={confirmDialog.description}
		onConfirm={confirmDialog.onConfirm}
	/>

	<!-- Filters and Actions -->
	<Card>
		<CardHeader>
			<CardTitle>Filters & Actions</CardTitle>
			<CardDescription>
				Filter processed files and perform bulk operations
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="search">Search</Label>
					<div class="relative">
						<Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							id="search"
							placeholder="Search by anime title, filename..."
							bind:value={searchQuery}
							class="pl-8"
						/>
					</div>
				</div>

				<div class="space-y-2">
					<Label for="whitelist-filter">Filter by Whitelist Entry</Label>
					<Select
						type="single"
						value={selectedWhitelistEntry}
						onValueChange={(value) => selectedWhitelistEntry = value || ''}
					>
						<SelectTrigger class="w-full">
							{selectedWhitelistEntry ?
								whitelistEntries.find(e => e.id.toString() === selectedWhitelistEntry)?.title || 'Select entry'
								: 'All entries'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">All entries</SelectItem>
							{#each whitelistEntries as entry (entry.id)}
								<SelectItem value={entry.id.toString()}>
									{entry.title}
								</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
			</div>

			<Separator />

			<div class="flex flex-wrap gap-2">
				<Button variant="destructive" onclick={confirmClearAllProcessedFiles}>
					<Trash2 class="w-4 h-4 mr-2" />
					Clear All Files
				</Button>

				<Button variant="destructive" onclick={confirmClearProcessedGuids}>
					<Trash2 class="w-4 h-4 mr-2" />
					Clear RSS GUIDs ({processedGuidsCount})
				</Button>

				{#if selectedWhitelistEntry}
					<Button
						variant="outline"
						onclick={() => confirmClearByWhitelistEntry(parseInt(selectedWhitelistEntry))}
					>
						<Trash2 class="w-4 h-4 mr-2" />
						Clear Selected Entry
					</Button>
				{/if}

				<Button variant="info" onclick={debugProcessedFiles}>
					<Database class="w-4 h-4 mr-2" />
					Debug Database
				</Button>
			</div>
		</CardContent>
	</Card>

	<!-- Processed Files List -->
	<Card>
		<CardHeader>
			<CardTitle>Processed Files ({filteredFiles.length})</CardTitle>
			<CardDescription>
				Files that have been processed and won't be downloaded again
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if isLoading}
				<div class="flex items-center justify-center py-8">
					<RefreshCw class="w-6 h-6 animate-spin mr-2" />
					Loading processed files...
				</div>
			{:else if filteredFiles.length === 0}
				<div class="text-center py-8 text-muted-foreground">
					{#if processedFiles.length === 0}
						No processed files found. Files will appear here after they are downloaded.
					{:else}
						No files match the current filters.
					{/if}
				</div>
			{:else}
				<div class="space-y-4">
					{#each filteredFiles as file}
						<div class="border rounded-lg p-4 space-y-3">
							<div class="flex items-start justify-between">
								<div class="space-y-1 flex-1">
									<h4 class="font-medium">{file.final_title}</h4>
									<p class="text-sm text-muted-foreground">{file.original_filename}</p>
									<div class="flex items-center gap-2 text-xs text-muted-foreground">
										<span>Whitelist: {file.whitelist_title || 'Unknown'}</span>
										<span>•</span>
										<span>Processed: {formatDate(file.processed_at)}</span>
									</div>
								</div>
								<div class="flex items-center gap-2">
									<Badge variant={getStatusBadgeVariant(file.download_status)}>
										{file.download_status}
									</Badge>
									<Button
										size="sm"
										variant="ghost"
										class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
										onclick={() => confirmDeleteProcessedFile(file.id)}
									>
										<Trash2 class="w-4 h-4" />
									</Button>
								</div>
							</div>

							<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
								{#if file.anime_title}
									<div>
										<span class="font-medium">Anime:</span>
										<span class="text-muted-foreground ml-1">{file.anime_title}</span>
									</div>
								{/if}
								{#if file.episode_number}
									<div>
										<span class="font-medium">Episode:</span>
										<span class="text-muted-foreground ml-1">{file.episode_number}</span>
									</div>
								{/if}
								{#if file.release_group}
									<div>
										<span class="font-medium">Group:</span>
										<span class="text-muted-foreground ml-1">{file.release_group}</span>
									</div>
								{/if}
								{#if file.video_resolution}
									<div>
										<span class="font-medium">Quality:</span>
										<span class="text-muted-foreground ml-1">{file.video_resolution}</span>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
