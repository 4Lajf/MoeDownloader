<script lang="ts">
	import { onMount } from 'svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		Download,
		CheckCircle,
		Clock,
		AlertCircle,
		Trash2,
		Plus,
		Users,
		ArrowDown,
		ArrowUp,
		HardDrive,
		Folder,
		FolderOpen,
		RotateCcw,
		Pause,
		Play
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ipc from '../../ipc';

	let downloads = $state<any[]>([]);
	let loading = $state(true);
	let showManualDialog = $state(false);
	let magnetLink = $state('');
	let downloadTitle = $state('');
	let addingDownload = $state(false);
	let downloadDirectory = $state('');
	let pausingAll = $state(false);

	// Pagination state
	let currentPage = $state(1);
	let itemsPerPage = $state(20);
	let totalPages = $state(1);
	let paginatedDownloads = $state<any[]>([]);

	onMount(() => {
		loadDownloads();
		loadDownloadDirectory();

		// Update downloads periodically
		const interval = setInterval(loadDownloads, 2000);
		return () => clearInterval(interval);
	});

	async function loadDownloads() {
		try {
			downloads = await ipc.getAllDownloads();
			updatePagination();
		} catch (error: any) {
			console.error('Error loading downloads:', error);
			toast.error('Failed to load downloads', {
				description: `Error loading downloads: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			loading = false;
		}
	}

	function updatePagination() {
		totalPages = Math.ceil(downloads.length / itemsPerPage);
		const startIndex = (currentPage - 1) * itemsPerPage;
		const endIndex = startIndex + itemsPerPage;
		paginatedDownloads = downloads.slice(startIndex, endIndex);
	}

	function goToPage(page: number) {
		if (page >= 1 && page <= totalPages) {
			currentPage = page;
			updatePagination();
		}
	}

	function nextPage() {
		if (currentPage < totalPages) {
			currentPage++;
			updatePagination();
		}
	}

	function prevPage() {
		if (currentPage > 1) {
			currentPage--;
			updatePagination();
		}
	}

	async function loadDownloadDirectory() {
		try {
			downloadDirectory = await ipc.getDownloadDirectory();
		} catch (error) {
			console.error('Error loading download directory:', error);
		}
	}

	async function removeDownload(id: number) {
		try {
			await ipc.removeDownload(id);
			await loadDownloads();
			toast.success('Download removed', {
				description: 'Download has been removed successfully.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error removing download:', error);
			toast.error('Failed to remove download', {
				description: `Error removing download: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}



	async function retryDownload(id: number) {
		try {
			await ipc.retryDownload(id);
			await loadDownloads();
			toast.success('Download retry initiated', {
				description: 'Download has been queued for retry.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error retrying download:', error);
			toast.error('Failed to retry download', {
				description: `Error retrying download: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function pauseDownload(id: number) {
		try {
			await ipc.pauseDownload(id);
			await loadDownloads();
		} catch (error: any) {
			console.error('Error pausing download:', error);
			toast.error('Failed to pause download', {
				description: `Error pausing download: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function resumeDownload(id: number) {
		try {
			await ipc.resumeDownload(id);
			await loadDownloads();
		} catch (error: any) {
			console.error('Error resuming download:', error);
			toast.error('Failed to resume download', {
				description: `Error resuming download: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function pauseAllDownloads() {
		try {
			pausingAll = true;
			const result = await ipc.pauseAllDownloads();
			await loadDownloads();

			if (result.pausedCount > 0) {
				toast.success('Downloads paused', {
					description: `Paused ${result.pausedCount} active download${result.pausedCount === 1 ? '' : 's'}.`,
					duration: 3000
				});
			} else {
				toast.info('No active downloads', {
					description: 'There are no active downloads to pause.',
					duration: 3000
				});
			}
		} catch (error: any) {
			console.error('Error pausing all downloads:', error);
			toast.error('Failed to pause downloads', {
				description: `Error pausing downloads: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			pausingAll = false;
		}
	}

	async function addManualDownload() {
		const input = magnetLink.trim();
		if (!input) {
			toast.error('Invalid input', {
				description: 'Please enter a magnet link or .torrent file URL.',
				duration: 3000
			});
			return;
		}

		// Validate input format
		const isMagnetLink = input.startsWith('magnet:');
		const isTorrentFile = input.startsWith('http') && input.includes('.torrent');

		if (!isMagnetLink && !isTorrentFile) {
			toast.error('Invalid format', {
				description: 'Please enter a valid magnet link (magnet:...) or .torrent file URL (http://...torrent).',
				duration: 4000
			});
			return;
		}

		try {
			addingDownload = true;
			await ipc.addManualDownload(input, downloadTitle.trim() || undefined);

			// Reset form and close dialog
			magnetLink = '';
			downloadTitle = '';
			showManualDialog = false;

			// Reload downloads to show the new one
			await loadDownloads();

			toast.success('Download added', {
				description: 'Manual download has been added to the queue.',
				duration: 4000
			});
		} catch (error: any) {
			console.error('Error adding manual download:', error);
			toast.error('Failed to add download', {
				description: `Error adding download: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			addingDownload = false;
		}
	}

	async function openFolder(filePath: string) {
		try {
			await ipc.openFolder(filePath);
			toast.success('Folder opened', {
				description: 'Download folder has been opened.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error opening folder:', error);
			toast.error('Failed to open folder', {
				description: `Error opening folder: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	function getStatusIcon(status: string) {
		switch (status) {
			case 'completed': return CheckCircle;
			case 'downloading': return Download;
			case 'queued': return Clock;
			case 'paused': return Pause;
			case 'failed': return AlertCircle;
			default: return Clock;
		}
	}

	function getStatusColor(status: string) {
		switch (status) {
			case 'completed': return 'text-green-500';
			case 'downloading': return 'text-blue-500';
			case 'queued': return 'text-yellow-500';
			case 'failed': return 'text-red-500';
			default: return 'text-gray-500';
		}
	}

	function formatBytes(bytes: number): string {
		if (!bytes || bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	function formatSpeed(bytesPerSecond: number): string {
		if (!bytesPerSecond || bytesPerSecond === 0) return '0 B/s';
		return formatBytes(bytesPerSecond) + '/s';
	}

	function formatTime(seconds: number): string {
		if (!seconds || seconds === Infinity || isNaN(seconds)) return '--';
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		} else if (minutes > 0) {
			return `${minutes}m ${secs}s`;
		} else {
			return `${secs}s`;
		}
	}

	function getETA(progress: number, downloadSpeed: number, totalSize: number): string {
		if (!progress || !downloadSpeed || !totalSize || progress >= 1) return '--';
		const remainingBytes = totalSize * (1 - progress);
		const eta = remainingBytes / downloadSpeed;
		return formatTime(eta);
	}
</script>

<div class="p-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Downloads</h1>
			<p class="text-muted-foreground">Manage your anime downloads</p>
		</div>
		<div class="flex gap-2">
			<Button
				variant="outline"
				class="gap-2"
				onclick={pauseAllDownloads}
				disabled={pausingAll || downloads.filter(d => d.status === 'downloading').length === 0}
			>
				<Pause class="w-4 h-4" />
				{pausingAll ? 'Pausing...' : 'Pause All'}
			</Button>

			<Dialog.Root bind:open={showManualDialog}>
			<Dialog.Trigger>
				<Button variant="success" class="gap-2">
					<Plus class="w-4 h-4" />
					Add Manual Download
				</Button>
			</Dialog.Trigger>
			<Dialog.Content class="sm:max-w-md">
				<Dialog.Header>
					<Dialog.Title>Add Manual Download</Dialog.Title>
					<Dialog.Description>
						Enter a magnet link or .torrent file URL to start downloading manually.
					</Dialog.Description>
				</Dialog.Header>
				<div class="space-y-4">
					<div>
						<Label for="magnet-link">Magnet Link or Torrent URL</Label>
						<Input
							id="magnet-link"
							bind:value={magnetLink}
							placeholder="magnet:?xt=urn:btih:... or https://nyaa.si/download/123456.torrent"
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="download-title">Title (Optional)</Label>
						<Input
							id="download-title"
							bind:value={downloadTitle}
							placeholder="Enter a custom title for this download"
							class="mt-1"
						/>
					</div>
				</div>
				<Dialog.Footer class="flex gap-2">
					<Dialog.Close>
						<Button variant="outline">Cancel</Button>
					</Dialog.Close>
					<Button
						variant="success"
						onclick={addManualDownload}
						disabled={!magnetLink.trim() || addingDownload}
					>
						{#if addingDownload}
							Adding...
						{:else}
							Add Download
						{/if}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
		</div>
	{:else if downloads.length === 0}
		<Card>
			<CardContent class="text-center py-12">
				<Download class="w-12 h-12 text-muted-foreground mx-auto mb-4" />
				<h3 class="text-lg font-semibold mb-2">No downloads</h3>
				<p class="text-muted-foreground">Downloads will appear here when RSS processing finds new episodes</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each paginatedDownloads as download}
				{@const StatusIcon = getStatusIcon(download.status)}
				<Card>
					<CardContent class="p-4">
						<div class="space-y-3">
							<!-- Header with title and actions -->
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3 flex-1 min-w-0">
									<StatusIcon class="w-5 h-5 {getStatusColor(download.status)} flex-shrink-0" />
									<div class="min-w-0 flex-1">
										<h3 class="font-medium truncate" title={download.final_title || download.torrent_title}>
											{download.final_title || download.torrent_title}
										</h3>
										{#if download.torrent_title && download.torrent_title !== (download.final_title || download.torrent_title)}
											<p class="text-xs text-muted-foreground truncate mt-1" title={download.torrent_title}>
												{download.torrent_title}
											</p>
										{/if}
										<p class="text-sm text-muted-foreground">
											{new Date(download.created_at).toLocaleString()}
										</p>
									</div>
								</div>

								<div class="flex items-center gap-2 flex-shrink-0">
									<Badge variant={download.status === 'completed' ? 'default' : 'secondary'}>
										{download.status}
									</Badge>

									{#if download.status === 'completed' && download.file_path}
										<Button size="sm" variant="outline" onclick={() => openFolder(download.file_path)} title="Open in folder">
											<FolderOpen class="w-4 h-4" />
										</Button>
									{:else if download.status === 'downloading'}
										<Button size="sm" variant="outline-warning" onclick={() => pauseDownload(download.id)} title="Pause download">
											<Pause class="w-4 h-4" />
										</Button>
									{:else if download.status === 'paused'}
										<Button size="sm" variant="outline-success" onclick={() => resumeDownload(download.id)} title="Resume download">
											<Play class="w-4 h-4" />
										</Button>
									{:else if download.status === 'failed'}
										<Button size="sm" variant="outline" onclick={() => retryDownload(download.id)} title="Retry download">
											<RotateCcw class="w-4 h-4" />
										</Button>
									{/if}

									<Button size="sm" variant="destructive" onclick={() => removeDownload(download.id)}>
										<Trash2 class="w-4 h-4" />
									</Button>
								</div>
							</div>

							<!-- Progress bar (for active downloads) -->
							{#if download.progress > 0 && (download.status === 'downloading' || download.status === 'paused')}
								<div class="space-y-2">
									<div class="flex items-center justify-between text-sm">
										<span class="text-muted-foreground">
											{Math.round(download.progress * 100)}% complete
										</span>
										{#if download.download_speed > 0}
											<span class="text-muted-foreground">
												ETA: {getETA(download.progress, download.download_speed, download.total_size)}
											</span>
										{/if}
									</div>
									<Progress value={download.progress * 100} class="h-2" />
								</div>
							{/if}

							<!-- Download stats (for active downloads) -->
							{#if download.status === 'downloading'}
								<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
									<div class="flex items-center gap-2">
										<ArrowDown class="w-4 h-4 text-green-500" />
										<div>
											<div class="font-medium">{formatSpeed(download.download_speed || 0)}</div>
											<div class="text-xs text-muted-foreground">Download</div>
										</div>
									</div>

									<div class="flex items-center gap-2">
										<ArrowUp class="w-4 h-4 text-blue-500" />
										<div>
											<div class="font-medium">{formatSpeed(download.upload_speed || 0)}</div>
											<div class="text-xs text-muted-foreground">Upload</div>
										</div>
									</div>

									<div class="flex items-center gap-2">
										<Users class="w-4 h-4 text-orange-500" />
										<div>
											<div class="font-medium">{download.peers || 0}</div>
											<div class="text-xs text-muted-foreground">Peers</div>
										</div>
									</div>

									<div class="flex items-center gap-2">
										<HardDrive class="w-4 h-4 text-purple-500" />
										<div>
											<div class="font-medium">{formatBytes(download.total_size || 0)}</div>
											<div class="text-xs text-muted-foreground">Size</div>
										</div>
									</div>
								</div>
							{:else if download.status === 'completed' && download.total_size}
								<div class="flex items-center gap-2 text-sm text-muted-foreground">
									<HardDrive class="w-4 h-4" />
									<span>Size: {formatBytes(download.total_size)}</span>
								</div>
							{/if}

							<!-- Error message and retry info for failed downloads -->
							{#if download.status === 'failed' && download.error_message}
								<div class="text-sm text-red-600 bg-red-50 p-2 rounded">
									<div class="font-medium">Error:</div>
									<div class="text-xs">{download.error_message}</div>
									{#if download.retry_count > 0}
										<div class="text-xs mt-1">
											Attempted {download.retry_count}/{download.max_retries || 3} retries
										</div>
									{/if}
								</div>
							{/if}

							<!-- Download location info -->
							<div class="text-sm text-muted-foreground">
								<div class="flex items-center gap-2">
									<Folder class="w-4 h-4" />
									<div class="flex-1 min-w-0">
										{#if download.status === 'completed' && download.file_path}
											<div class="font-medium truncate">{download.file_name || 'Unknown file'}</div>
											<div class="text-xs truncate">{download.file_path}</div>
										{:else if download.status === 'downloading' || download.status === 'queued'}
											<div class="text-xs">Downloading to: {downloadDirectory}</div>
										{:else}
											<div class="text-xs">Download location: {downloadDirectory}</div>
										{/if}
									</div>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>

		<!-- Pagination Controls -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between mt-6">
				<div class="text-sm text-muted-foreground">
					Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, downloads.length)} of {downloads.length} downloads
				</div>

				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onclick={prevPage}
						disabled={currentPage === 1}
					>
						Previous
					</Button>

					{#if totalPages <= 7}
						{#each Array.from({length: totalPages}, (_, i) => i + 1) as page}
							<Button
								variant={currentPage === page ? "default" : "outline"}
								size="sm"
								onclick={() => goToPage(page)}
							>
								{page}
							</Button>
						{/each}
					{:else}
						<!-- Show first page -->
						<Button
							variant={currentPage === 1 ? "default" : "outline"}
							size="sm"
							onclick={() => goToPage(1)}
						>
							1
						</Button>

						{#if currentPage > 3}
							<span class="px-2">...</span>
						{/if}

						<!-- Show pages around current page -->
						{#each Array.from({length: 3}, (_, i) => Math.max(2, Math.min(totalPages - 1, currentPage - 1 + i))) as page}
							{#if page > 1 && page < totalPages}
								<Button
									variant={currentPage === page ? "default" : "outline"}
									size="sm"
									onclick={() => goToPage(page)}
								>
									{page}
								</Button>
							{/if}
						{/each}

						{#if currentPage < totalPages - 2}
							<span class="px-2">...</span>
						{/if}

						<!-- Show last page -->
						<Button
							variant={currentPage === totalPages ? "default" : "outline"}
							size="sm"
							onclick={() => goToPage(totalPages)}
						>
							{totalPages}
						</Button>
					{/if}

					<Button
						variant="outline"
						size="sm"
						onclick={nextPage}
						disabled={currentPage === totalPages}
					>
						Next
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
