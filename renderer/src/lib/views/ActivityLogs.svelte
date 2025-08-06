<script lang="ts">
	import { onMount } from 'svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';

	import {
		Trash2,
		RefreshCw,
		SlidersHorizontal,
		Clock,
		Check,
		X,
		Pause,
		Play
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ipc from '../../ipc';

	let logs = $state<any[]>([]);
	let filteredLogs = $state<any[]>([]);
	let loading = $state(true);
	let searchTerm = $state('');
	let selectedType = $state('all');
	let autoRefresh = $state(true);
	let refreshInterval: NodeJS.Timeout | null = null;

	// Confirmation dialog state
	let confirmDialog = $state({
		open: false,
		title: '',
		description: '',
		onConfirm: () => {}
	});

	const logTypes = [
		{ value: 'all', label: 'All Events' },
		{ value: 'download', label: 'Downloads' },
		{ value: 'rss', label: 'RSS Processing' },
		{ value: 'whitelist', label: 'Whitelist Matches' },
		{ value: 'skip', label: 'Skipped Episodes' },
		{ value: 'app', label: 'Application Events' }
	];

	const typeColors: Record<string, string> = {
		download: 'bg-blue-500',
		rss: 'bg-green-500',
		whitelist: 'bg-purple-500',
		skip: 'bg-yellow-500',
		app: 'bg-gray-500'
	};

	onMount(() => {
		loadLogs();
		
		if (autoRefresh) {
			startAutoRefresh();
		}

		return () => {
			if (refreshInterval) {
				clearInterval(refreshInterval);
			}
		};
	});

	function startAutoRefresh() {
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}
		refreshInterval = setInterval(loadLogs, 5000); // Refresh every 5 seconds
	}

	function stopAutoRefresh() {
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}
	}

	$effect(() => {
		if (autoRefresh) {
			startAutoRefresh();
		} else {
			stopAutoRefresh();
		}
	});

	$effect(() => {
		// Filter logs when search term or type changes
		let filtered = logs;

		if (selectedType !== 'all') {
			filtered = filtered.filter(log => log.type === selectedType);
		}

		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(log => 
				log.title.toLowerCase().includes(term) ||
				log.description?.toLowerCase().includes(term)
			);
		}

		filteredLogs = filtered;
	});

	async function loadLogs() {
		try {
			const result = await ipc.getActivityLogs(500); // Get last 500 logs for more history
			logs = result || [];
		} catch (error: any) {
			console.error('Error loading activity logs:', error);
			toast.error('Failed to load logs', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			loading = false;
		}
	}

	function confirmClearLogs() {
		confirmDialog = {
			open: true,
			title: 'Clear Activity Logs',
			description: 'Are you sure you want to clear all activity logs? This action cannot be undone.',
			onConfirm: () => clearLogs()
		};
	}

	async function clearLogs() {
		try {
			await ipc.clearActivityLogs();
			logs = [];
			toast.success('Activity logs cleared', {
				description: 'All activity logs have been cleared.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error clearing activity logs:', error);
			toast.error('Failed to clear logs', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	function getLogColor(type: string) {
		return typeColors[type] || 'bg-gray-500';
	}
</script>

<div class="p-6 space-y-4">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Activity Logs</h1>
			<p class="text-muted-foreground">View recent application activity and events</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" onclick={loadLogs} disabled={loading}>
				<RefreshCw class="w-4 h-4 mr-2 {loading ? 'animate-spin' : ''}" />
				Refresh
			</Button>
			<Button variant="destructive" onclick={confirmClearLogs}>
				<Trash2 class="w-4 h-4 mr-2" />
				Clear Logs
			</Button>
		</div>
	</div>

	<!-- Compact filters bar -->
	<div class="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg">
		<div class="flex items-center gap-2">
			<SlidersHorizontal class="w-4 h-4 text-muted-foreground" />
			<span class="text-sm font-medium">Filters:</span>
		</div>

		<div class="flex-1 min-w-48">
			<Input
				bind:value={searchTerm}
				placeholder="Search logs..."
				class="h-8 text-sm"
			/>
		</div>

		<Select
			type="single"
			value={selectedType}
			onValueChange={(value) => selectedType = value || 'all'}
		>
			<SelectTrigger class="h-8 w-32">
				{logTypes.find(t => t.value === selectedType)?.label || 'All Types'}
			</SelectTrigger>
			<SelectContent>
				{#each logTypes as type (type.value)}
					<SelectItem value={type.value}>
						{type.label}
					</SelectItem>
				{/each}
			</SelectContent>
		</Select>

		<div class="flex items-center gap-2">
			<input
				type="checkbox"
				id="auto-refresh"
				bind:checked={autoRefresh}
				class="rounded"
			/>
			<label for="auto-refresh" class="text-sm">Auto-refresh</label>
		</div>
	</div>

	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<CardTitle class="text-lg -mb-2">Recent Activity</CardTitle>
				<div class="text-sm text-muted-foreground">
					{filteredLogs.length} events
					{#if selectedType !== 'all'}
						({logTypes.find(t => t.value === selectedType)?.label.toLowerCase()})
					{/if}
				</div>
			</div>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<RefreshCw class="w-6 h-6 animate-spin mr-2" />
					Loading activity logs...
				</div>
			{:else if filteredLogs.length === 0}
				<div class="text-center py-8 text-muted-foreground">
					{#if logs.length === 0}
						No activity logs found. Activity will appear here as you use the application.
					{:else}
						No logs match your current filters.
					{/if}
				</div>
			{:else}
				<div class="space-y-0">
					{#each filteredLogs as log}
						<div class="flex items-center gap-2 px-3 rounded hover:bg-accent/50 transition-colors text-sm">
							<!-- Compact type indicator -->
							<div class="w-2 h-2 rounded-full {getLogColor(log.type)} flex-shrink-0"></div>

							<!-- Status icon -->
							<div class="flex-shrink-0">
								{#if log.title.includes('Completed') || log.title.includes('Match')}
									<Check class="w-3 h-3 text-green-600" />
								{:else if log.title.includes('Failed') || log.title.includes('No Match')}
									<X class="w-3 h-3 text-red-600" />
								{:else if log.title.includes('Paused')}
									<Pause class="w-3 h-3 text-yellow-600" />
								{:else if log.title.includes('Resumed') || log.title.includes('Started')}
									<Play class="w-3 h-3 text-blue-600" />
								{:else}
									<Clock class="w-3 h-3 text-gray-600" />
								{/if}
							</div>

							<!-- Time -->
							<span class="text-xs text-muted-foreground font-mono w-16 flex-shrink-0">
								{new Date(log.created_at).toLocaleTimeString('en-US', {
									hour12: false,
									hour: '2-digit',
									minute: '2-digit',
									second: '2-digit'
								})}
							</span>

							<!-- Type badge -->
							<span class="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium w-20 text-center flex-shrink-0">
								{log.type.toUpperCase()}
							</span>

							<!-- Title and description -->
							<div class="flex-1 min-w-0">
								<span class="font-medium">{log.title}</span>
								{#if log.description}
									<span class="text-muted-foreground ml-2">- {log.description}</span>
								{/if}
							</div>

							<!-- Metadata indicator -->
							{#if log.metadata && Object.keys(log.metadata).length > 0}
								<span class="text-xs text-muted-foreground opacity-50 flex-shrink-0">
									+{Object.keys(log.metadata).length}
								</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>

<ConfirmDialog
	bind:open={confirmDialog.open}
	title={confirmDialog.title}
	description={confirmDialog.description}
	onConfirm={confirmDialog.onConfirm}
/>
