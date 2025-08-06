<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import type { ColumnSizingState } from '@tanstack/table-core';
	import {
		Search as SearchIcon,
		Download,
		ArrowUpDown,
		ArrowUp,
		ArrowDown,
		LoaderCircle,
		Info,
		FileText,
		ListPlus
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { onMount, onDestroy } from 'svelte';
	import ipc from '../../ipc';

	// Search state with persistence
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let filteredResults = $state<any[]>([]);
	let isSearching = $state(false);
	let hasSearched = $state(false);

	// State persistence key
	const SEARCH_STATE_KEY = 'moe-downloader-search-state';

	// Selection state
	let selectedItems = $state<Set<string>>(new Set());
	let selectAll = $state(false);

	// Filtering state
	let availableGroups = $state<string[]>([]);
	let selectedGroups = $state<Set<string>>(new Set());



	// Sorting state
	let sortColumn = $state<string>('pubDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');

	// Column sizing state
	let columnSizing = $state<ColumnSizingState>({
		select: 48,
		animeTitle: 320,
		episode: 80,
		quality: 80,
		group: 96,
		size: 80,
		seeders: 64,
		pubDate: 150,
		title: 700
	});

	// Column resize handlers
	let isResizing = $state(false);
	let resizingColumn = $state<string | null>(null);

	// State persistence functions
	function saveSearchState() {
		const state = {
			searchQuery,
			searchResults,
			filteredResults,
			hasSearched,
			selectedItems: Array.from(selectedItems),
			selectedGroups: Array.from(selectedGroups),
			availableGroups,
			sortColumn,
			sortDirection,
			columnSizing
		};
		localStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state));
	}

	function loadSearchState() {
		try {
			const savedState = localStorage.getItem(SEARCH_STATE_KEY);
			if (savedState) {
				const state = JSON.parse(savedState);
				searchQuery = state.searchQuery || '';
				searchResults = state.searchResults || [];
				filteredResults = state.filteredResults || [];
				hasSearched = state.hasSearched || false;
				selectedItems = new Set(state.selectedItems || []);
				selectedGroups = new Set(state.selectedGroups || []);
				availableGroups = state.availableGroups || [];
				sortColumn = state.sortColumn || 'pubDate';
				sortDirection = state.sortDirection || 'desc';
				columnSizing = state.columnSizing || columnSizing;

				// Update select all state based on restored selection
				updateSelectAllState();
			}
		} catch (error) {
			console.error('Failed to load search state:', error);
		}
	}

	// Lifecycle hooks
	onMount(() => {
		loadSearchState();
	});

	onDestroy(() => {
		saveSearchState();
	});

	// Auto-save state on key changes
	$effect(() => {
		// Save state when search results change
		if (hasSearched) {
			saveSearchState();
		}
	});

	// Dialog state
	let showAddToWhitelistDialog = $state(false);
	let selectedItem = $state<any>(null);
	let whitelistGroupOption = $state<'specific' | 'all'>('specific');

	// Context menu state
	let contextMenuOpen = $state(false);
	let contextMenuX = $state(0);
	let contextMenuY = $state(0);
	let contextMenuItem = $state<any>(null);

	async function performSearch() {
		if (!searchQuery.trim()) {
			toast.error('Please enter a search query');
			return;
		}

		isSearching = true;
		selectedItems.clear();
		selectedItems = new Set(); // Force reactivity
		selectAll = false;
		selectedGroups.clear();

		try {
			const result = await ipc.searchRSSFeed(searchQuery.trim());

			if (result.success) {
				searchResults = result.items || [];

				// Extract unique groups from search results
				const groups = new Set<string>();
				searchResults.forEach(item => {
					const group = getGroupName(item);
					if (group && group !== 'Unknown') {
						groups.add(group);
					}
				});
				availableGroups = Array.from(groups).sort();

				// Apply initial filtering
				applyFilters();

				hasSearched = true;
			} else {
				throw new Error('Search failed');
			}
		} catch (error: any) {
			toast.error('Search failed', {
				description: error?.message || 'Failed to search RSS feed',
				duration: 5000
			});
			searchResults = [];
			filteredResults = [];
			availableGroups = [];
		} finally {
			isSearching = false;
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			performSearch();
		}
	}

	// Filtering functions
	function applyFilters() {
		if (selectedGroups.size === 0) {
			filteredResults = [...searchResults];
		} else {
			filteredResults = searchResults.filter(item => {
				const group = getGroupName(item);
				return selectedGroups.has(group);
			});
		}

		// Update selection state based on filtered results
		updateSelectAllState();
	}

	function toggleGroupFilter(group: string) {
		if (selectedGroups.has(group)) {
			selectedGroups.delete(group);
		} else {
			selectedGroups.add(group);
		}
		// Force reactivity by creating a new Set
		selectedGroups = new Set(selectedGroups);
		applyFilters();
	}

	function clearGroupFilters() {
		selectedGroups.clear();
		// Force reactivity by creating a new Set
		selectedGroups = new Set();
		applyFilters();
	}

	// Selection functions
	function updateSelectAllState() {
		const hasItems = filteredResults.length > 0;
		const allSelected = hasItems && filteredResults.every(item => selectedItems.has(item.guid));
		selectAll = allSelected;
	}

	function toggleSelectAll() {
		if (selectAll) {
			// Unselect all filtered items
			filteredResults.forEach(item => selectedItems.delete(item.guid));
		} else {
			// Select all filtered items
			filteredResults.forEach(item => selectedItems.add(item.guid));
		}
		// Force reactivity by creating a new Set
		selectedItems = new Set(selectedItems);
		updateSelectAllState();
	}

	function toggleItemSelection(guid: string) {
		if (selectedItems.has(guid)) {
			selectedItems.delete(guid);
		} else {
			selectedItems.add(guid);
		}
		// Force reactivity by creating a new Set
		selectedItems = new Set(selectedItems);
		updateSelectAllState();
	}

	// Mass download function
	async function downloadSelected() {
		if (selectedItems.size === 0) {
			toast.error('No items selected');
			return;
		}

		const selectedTorrents = searchResults.filter(item => selectedItems.has(item.guid));
		let successCount = 0;
		let errorCount = 0;

		for (const item of selectedTorrents) {
			try {
				await ipc.addManualDownload(item.link, item.title);
				successCount++;
			} catch (error) {
				errorCount++;
			}
		}

		if (successCount > 0) {
			toast.success(`Added ${successCount} downloads`, {
				description: errorCount > 0 ? `${errorCount} failed to add` : 'All downloads added successfully',
				duration: 4000
			});
		}

		if (errorCount > 0 && successCount === 0) {
			toast.error('Failed to add downloads', {
				description: 'All selected downloads failed to add',
				duration: 5000
			});
		}

		// Clear selection after download
		selectedItems.clear();
		selectedItems = new Set(); // Force reactivity
		selectAll = false;
	}

	function sortResults(column: string) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'desc';
		}

		const sortFunction = (a: any, b: any) => {
			let aVal, bVal;

			// Handle special column mappings
			if (column === 'group') {
				aVal = getGroupName(a);
				bVal = getGroupName(b);
			} else if (column === 'episode') {
				aVal = getEpisodeNumber(a);
				bVal = getEpisodeNumber(b);
			} else if (column === 'quality') {
				aVal = getVideoResolution(a);
				bVal = getVideoResolution(b);
			} else if (column === 'animeTitle') {
				aVal = getAnimeTitle(a);
				bVal = getAnimeTitle(b);
			} else {
				aVal = a[column];
				bVal = b[column];
			}

			// Handle special cases
			if (column === 'seeders' || column === 'leechers' || column === 'downloads') {
				aVal = parseInt(aVal) || 0;
				bVal = parseInt(bVal) || 0;
			} else if (column === 'episode') {
				aVal = parseInt(aVal) || 0;
				bVal = parseInt(bVal) || 0;
			} else if (column === 'pubDate') {
				aVal = new Date(aVal).getTime();
				bVal = new Date(bVal).getTime();
			} else if (typeof aVal === 'string') {
				aVal = aVal.toLowerCase();
				bVal = bVal.toLowerCase();
			}

			if (sortDirection === 'asc') {
				return aVal > bVal ? 1 : -1;
			} else {
				return aVal < bVal ? 1 : -1;
			}
		};

		// Sort both the original results and filtered results
		searchResults = [...searchResults].sort(sortFunction);
		filteredResults = [...filteredResults].sort(sortFunction);
	}

	function getSortIcon(column: string) {
		if (sortColumn !== column) return ArrowUpDown;
		return sortDirection === 'asc' ? ArrowUp : ArrowDown;
	}

	// Column resizing functions
	function createResizeHandler(columnId: string) {
		return (event: MouseEvent | TouchEvent) => {
			event.preventDefault();
			event.stopPropagation();

			isResizing = true;
			resizingColumn = columnId;
			document.body.classList.add('resizing');

			const startX = 'touches' in event ? event.touches[0].clientX : event.clientX;
			const startWidth = columnSizing[columnId] || 150;

			const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
				const currentX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
				const diff = currentX - startX;
				const newWidth = Math.max(50, Math.min(800, startWidth + diff));

				columnSizing = { ...columnSizing, [columnId]: newWidth };
			};

			const handleEnd = () => {
				isResizing = false;
				resizingColumn = null;
				document.body.classList.remove('resizing');
				document.removeEventListener('mousemove', handleMove);
				document.removeEventListener('mouseup', handleEnd);
				document.removeEventListener('touchmove', handleMove);
				document.removeEventListener('touchend', handleEnd);
			};

			document.addEventListener('mousemove', handleMove);
			document.addEventListener('mouseup', handleEnd);
			document.addEventListener('touchmove', handleMove);
			document.addEventListener('touchend', handleEnd);
		};
	}

	function formatDate(dateString: string) {
		try {
			return new Date(dateString).toLocaleString();
		} catch {
			return dateString;
		}
	}

	function formatSize(size: string) {
		return size || 'Unknown';
	}

	function getGroupName(item: any) {
		return item.parsedData?.releaseGroup || 'Unknown';
	}

	function getAnimeTitle(item: any) {
		// Get base title
		let baseTitle = '';
		if (item.parsedData?.animeTitle) {
			baseTitle = item.parsedData.animeTitle;
		} else {
			// Fallback to original title, but try to clean it up a bit
			baseTitle = item.title || 'Unknown Title';
		}

		// Add season information to title if available
		const seasonNumber = getSeasonNumber(item);
		if (seasonNumber && seasonNumber !== '0') {
			return `${baseTitle} (Season ${seasonNumber})`;
		}

		return baseTitle;
	}

	function getBaseTitleForSearch(item: any) {
		// Get base title without season information for external searches
		if (item.parsedData?.animeTitle) {
			return item.parsedData.animeTitle;
		} else {
			// Fallback to original title, but try to clean it up a bit
			return item.title || 'Unknown Title';
		}
	}

	function getEpisodeNumber(item: any) {
		return item.parsedData?.episodeNumber || '';
	}

	function getSeasonNumber(item: any) {
		return item.parsedData?.animeSeason || '';
	}

	function getEpisodeDisplay(item: any) {
		const episodeNumber = getEpisodeNumber(item);

		if (!episodeNumber) return '';

		// Show only the episode number
		return episodeNumber;
	}

	function getVideoResolution(item: any) {
		return item.parsedData?.videoResolution || '';
	}



	// Right-click context menu handler
	function handleRightClick(event: MouseEvent, item: any) {
		event.preventDefault();
		contextMenuItem = item;
		contextMenuX = event.clientX;
		contextMenuY = event.clientY;
		contextMenuOpen = true;
	}

	// Context menu functions
	async function viewAnimeInfo(item: any) {
		try {
			const baseTitle = getBaseTitleForSearch(item);
			const searchQuery = encodeURIComponent(baseTitle);
			const anilistUrl = `https://anilist.co/search/anime?search=${searchQuery}`;

			await ipc.openExternal(anilistUrl);
			toast.success('Opening AniList search', {
				description: `Searching for "${baseTitle}" on AniList`,
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error opening AniList:', error);
			toast.error('Failed to open AniList', {
				description: error?.message || 'Unknown error',
				duration: 5000
			});
		}
	}

	async function viewTorrentInfo(item: any) {
		try {
			// Use the GUID which contains the Nyaa.si permalink (e.g., https://nyaa.si/view/2002197)
			// instead of the .torrent file link
			const nyaaUrl = item.guid;

			if (nyaaUrl && typeof nyaaUrl === 'string' && nyaaUrl.includes('nyaa.si/view/')) {
				await ipc.openExternal(nyaaUrl);
				toast.success('Opening torrent page', {
					description: 'Opening torrent page on Nyaa.si',
					duration: 3000
				});
			} else {
				// Fallback to link if GUID is not available or doesn't match expected format
				const fallbackUrl = item.link;
				if (fallbackUrl && typeof fallbackUrl === 'string') {
					await ipc.openExternal(fallbackUrl);
					toast.success('Opening torrent page', {
						description: 'Opening torrent on Nyaa.si',
						duration: 3000
					});
				} else {
					toast.error('No torrent link available', {
						description: 'This item does not have a valid torrent link',
						duration: 5000
					});
				}
			}
		} catch (error: any) {
			console.error('Error opening torrent:', error);
			toast.error('Failed to open torrent page', {
				description: error?.message || 'Unknown error',
				duration: 5000
			});
		}
	}

	function openAddToWhitelistDialog(item: any) {
		selectedItem = item;
		whitelistGroupOption = 'specific';
		showAddToWhitelistDialog = true;
	}

	async function addToWhitelist() {
		if (!selectedItem) return;

		try {
			const animeTitle = getAnimeTitle(selectedItem);
			const groupName = getGroupName(selectedItem);
			
			const whitelistEntry = {
				title: animeTitle,
				keywords: '',
				exclude_keywords: '',
				quality: '1080p',
				group: whitelistGroupOption === 'specific' ? groupName : 'any',
				enabled: true
			};

			await ipc.addWhitelistEntry(whitelistEntry);
			
			const groupText = whitelistGroupOption === 'specific' ? ` (${groupName} only)` : ' (any group)';
			toast.success('Added to whitelist', {
				description: `"${animeTitle}"${groupText} has been added to the whitelist`,
				duration: 4000
			});
			
			showAddToWhitelistDialog = false;
			selectedItem = null;
		} catch (error: any) {
			console.error('Error adding to whitelist:', error);
			toast.error('Failed to add to whitelist', {
				description: error?.message || 'Unknown error',
				duration: 5000
			});
		}
	}
</script>

<div class="p-6">
	<!-- Minimalistic Search Bar -->
	<div class="mb-6">
		<div class="flex gap-4 items-center">
			<div class="flex-1">
				<Input
					bind:value={searchQuery}
					placeholder="Search nyaa.si for anime torrents..."
					onkeypress={handleKeyPress}
					disabled={isSearching}
					class="text-lg py-3"
				/>
			</div>
			<Button onclick={performSearch} disabled={isSearching || !searchQuery.trim()} size="lg">
				{#if isSearching}
					<LoaderCircle class="w-5 h-5 mr-2 animate-spin" />
					Searching...
				{:else}
					<SearchIcon class="w-5 h-5 mr-2" />
					Search
				{/if}
			</Button>
			{#if selectedItems.size > 0}
				<Button onclick={downloadSelected} variant="success" size="lg">
					<Download class="w-5 h-5 mr-2" />
					Download Selected ({selectedItems.size})
				</Button>
			{/if}
		</div>
	</div>

	<!-- Search Results -->
	{#if hasSearched}
		{#if searchResults.length > 0}
			<div class="mb-4 space-y-2">
				<div class="text-sm text-muted-foreground">
					{searchResults.length} results
					{#if filteredResults.length !== searchResults.length}
						• {filteredResults.length} shown
					{/if}
				</div>

				<!-- Group Filter -->
				{#if availableGroups.length > 0}
					<div class="flex flex-wrap items-center gap-1">
						{#each availableGroups as group}
							<button
								type="button"
								class="inline-flex items-center justify-center gap-1 text-xs font-medium rounded-md border transition-all duration-200 select-none filter-button {selectedGroups.has(group)
									? 'px-3 py-0.5 bg-primary text-primary-foreground border-primary shadow-md font-bold pressed-filter !important'
									: 'px-2 py-0.5 bg-background text-foreground border-border hover:bg-muted hover:text-foreground hover:shadow-sm hover:scale-102'}"
								onclick={() => toggleGroupFilter(group)}
								aria-pressed={selectedGroups.has(group)}
								aria-label={`Filter by ${group} group`}
							>
								{#if selectedGroups.has(group)}
									<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
									</svg>
								{/if}
								{group}
							</button>
						{/each}
						{#if selectedGroups.size > 0}
							<Button variant="ghost" size="sm" onclick={clearGroupFilters} class="h-6 px-2 text-xs">
								Clear
							</Button>
						{/if}
					</div>
				{/if}
			</div>

			<Card>
				<CardContent class="p-0">
					<div class="rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head class="relative" style="width: {columnSizing.select}px; min-width: 48px;">
										<Checkbox
											checked={selectAll}
											onCheckedChange={toggleSelectAll}
											aria-label="Select all"
										/>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize select column"
											onmousedown={createResizeHandler('select')}
											ontouchstart={createResizeHandler('select')}
										></button>
									</Table.Head>
									<Table.Head class="relative" style="width: {columnSizing.animeTitle}px; min-width: 200px;">
										<Button variant="ghost" size="sm" onclick={() => sortResults('animeTitle')}>
											Anime Title
											{@const IconComponent = getSortIcon('animeTitle')}
											<IconComponent class="ml-2 h-4 w-4" />
										</Button>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize anime title column"
											onmousedown={createResizeHandler('animeTitle')}
											ontouchstart={createResizeHandler('animeTitle')}
										></button>
									</Table.Head>
									<Table.Head class="relative" style="width: {columnSizing.episode}px; min-width: 60px;">
										<Button variant="ghost" size="sm" onclick={() => sortResults('episode')}>
											Episode
											{@const IconComponent = getSortIcon('episode')}
											<IconComponent class="ml-2 h-4 w-4" />
										</Button>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize episode column"
											onmousedown={createResizeHandler('episode')}
											ontouchstart={createResizeHandler('episode')}
										></button>
									</Table.Head>
									<Table.Head class="relative" style="width: {columnSizing.quality}px; min-width: 60px;">
										<Button variant="ghost" size="sm" onclick={() => sortResults('quality')}>
											Quality
											{@const IconComponent = getSortIcon('quality')}
											<IconComponent class="ml-2 h-4 w-4" />
										</Button>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize quality column"
											onmousedown={createResizeHandler('quality')}
											ontouchstart={createResizeHandler('quality')}
										></button>
									</Table.Head>
									<Table.Head class="relative" style="width: {columnSizing.group}px; min-width: 80px;">
										<Button variant="ghost" size="sm" onclick={() => sortResults('group')}>
											Group
											{@const IconComponent = getSortIcon('group')}
											<IconComponent class="ml-2 h-4 w-4" />
										</Button>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize group column"
											onmousedown={createResizeHandler('group')}
											ontouchstart={createResizeHandler('group')}
										></button>
									</Table.Head>
									<Table.Head class="relative" style="width: {columnSizing.size}px; min-width: 60px;">
										<Button variant="ghost" size="sm" onclick={() => sortResults('size')}>
											Size
											{@const IconComponent = getSortIcon('size')}
											<IconComponent class="ml-2 h-4 w-4" />
										</Button>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize size column"
											onmousedown={createResizeHandler('size')}
											ontouchstart={createResizeHandler('size')}
										></button>
									</Table.Head>
									<Table.Head class="relative" style="width: {columnSizing.seeders}px; min-width: 50px;">
										<Button variant="ghost" size="sm" onclick={() => sortResults('seeders')}>
											S/L
											{@const IconComponent = getSortIcon('seeders')}
											<IconComponent class="ml-2 h-4 w-4" />
										</Button>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize seeders column"
											onmousedown={createResizeHandler('seeders')}
											ontouchstart={createResizeHandler('seeders')}
										></button>
									</Table.Head>
									<Table.Head class="relative" style="width: {columnSizing.pubDate}px; min-width: 80px;">
										<Button variant="ghost" size="sm" onclick={() => sortResults('pubDate')}>
											Date
											{@const IconComponent = getSortIcon('pubDate')}
											<IconComponent class="ml-2 h-4 w-4" />
										</Button>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize date column"
											onmousedown={createResizeHandler('pubDate')}
											ontouchstart={createResizeHandler('pubDate')}
										></button>
									</Table.Head>
									<Table.Head class="relative" style="width: {columnSizing.title}px; min-width: 200px;">
										<Button variant="ghost" size="sm" onclick={() => sortResults('title')}>
											Filename
											{@const IconComponent = getSortIcon('title')}
											<IconComponent class="ml-2 h-4 w-4" />
										</Button>
										<button
											type="button"
											class="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-border opacity-0 hover:opacity-100 transition-opacity resize-handle"
											aria-label="Resize filename column"
											onmousedown={createResizeHandler('title')}
											ontouchstart={createResizeHandler('title')}
										></button>
									</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each filteredResults as item}
									<Table.Row
										class="table-row-clickable {selectedItems.has(item.guid) ? 'table-row-selected' : ''}"
										onclick={(e) => {
											// Don't toggle if clicking on checkbox or context menu
											const target = e.target as HTMLElement;
											if (target?.closest('input[type="checkbox"]') || target?.closest('button')) {
												return;
											}
											toggleItemSelection(item.guid);
										}}
										oncontextmenu={(e) => handleRightClick(e, item)}
									>
										<Table.Cell style="width: {columnSizing.select}px;">
											<Checkbox
												checked={selectedItems.has(item.guid)}
												onCheckedChange={() => toggleItemSelection(item.guid)}
												aria-label="Select item"
											/>
										</Table.Cell>
										<Table.Cell style="width: {columnSizing.animeTitle}px;">
											<div class="font-medium truncate" title={getAnimeTitle(item)}>
												{getAnimeTitle(item)}
											</div>
										</Table.Cell>
										<Table.Cell style="width: {columnSizing.episode}px;">
											{#if getEpisodeDisplay(item)}
												<Badge variant="outline">{getEpisodeDisplay(item)}</Badge>
											{:else}
												<span class="text-muted-foreground">-</span>
											{/if}
										</Table.Cell>
										<Table.Cell style="width: {columnSizing.quality}px;">
											{#if getVideoResolution(item)}
												<Badge variant="outline">{getVideoResolution(item)}</Badge>
											{:else}
												<span class="text-muted-foreground">-</span>
											{/if}
										</Table.Cell>
										<Table.Cell style="width: {columnSizing.group}px;">
											<Badge variant="secondary">{getGroupName(item)}</Badge>
										</Table.Cell>
										<Table.Cell style="width: {columnSizing.size}px;">
											<span class="text-sm">{formatSize(item.size)}</span>
										</Table.Cell>
										<Table.Cell style="width: {columnSizing.seeders}px;">
											<div class="flex items-center gap-1 text-sm">
												<span class="text-green-600">{item.seeders}</span>
												<span class="text-muted-foreground">/</span>
												<span class="text-red-600">{item.leechers}</span>
											</div>
										</Table.Cell>
										<Table.Cell style="width: {columnSizing.pubDate}px;">
											<span class="text-sm text-muted-foreground">
												{formatDate(item.pubDate)}
											</span>
										</Table.Cell>
										<Table.Cell style="width: {columnSizing.title}px;">
											<div class="font-medium truncate" title={item.title}>
												{item.title}
											</div>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				</CardContent>
			</Card>
		{:else}
			<Card>
				<CardContent class="text-center py-12">
					<SearchIcon class="w-12 h-12 text-muted-foreground mx-auto mb-4" />
					<h3 class="text-lg font-semibold mb-2">No results found</h3>
					<p class="text-muted-foreground">Try adjusting your search terms or check the spelling</p>
				</CardContent>
			</Card>
		{/if}
	{/if}
</div>

<!-- Add to Whitelist Dialog -->
<Dialog.Root bind:open={showAddToWhitelistDialog}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add to Whitelist</Dialog.Title>
			<Dialog.Description>
				Add "{selectedItem ? getAnimeTitle(selectedItem) : ''}" to your whitelist for automatic downloads.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4">
			<div class="space-y-3">
				<Label>Group Preference</Label>
				<div class="space-y-2">
					<label class="flex items-center space-x-2">
						<input type="radio" bind:group={whitelistGroupOption} value="specific" />
						<span>Only from "{selectedItem ? getGroupName(selectedItem) : ''}" group</span>
					</label>
					<label class="flex items-center space-x-2">
						<input type="radio" bind:group={whitelistGroupOption} value="all" />
						<span>From any group</span>
					</label>
				</div>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => showAddToWhitelistDialog = false}>
				Cancel
			</Button>
			<Button onclick={addToWhitelist}>
				Add to Whitelist
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Right-click Context Menu -->
{#if contextMenuOpen}
	<div
		class="fixed z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
		style="left: {contextMenuX}px; top: {contextMenuY}px;"
		role="menu"
		tabindex="-1"
		onkeydown={(e) => e.key === 'Escape' && (contextMenuOpen = false)}
	>
		<button
			type="button"
			class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
			onclick={() => {
				if (contextMenuItem) viewAnimeInfo(contextMenuItem);
				contextMenuOpen = false;
			}}
		>
			<Info class="w-4 h-4 mr-2" />
			Search on AniList
		</button>
		<button
			type="button"
			class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
			onclick={() => {
				if (contextMenuItem) viewTorrentInfo(contextMenuItem);
				contextMenuOpen = false;
			}}
		>
			<FileText class="w-4 h-4 mr-2" />
			View on Nyaa.si
		</button>
		<div class="h-px bg-muted my-1"></div>
		<button
			type="button"
			class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
			onclick={() => {
				if (contextMenuItem) openAddToWhitelistDialog(contextMenuItem);
				contextMenuOpen = false;
			}}
		>
			<ListPlus class="w-4 h-4 mr-2" />
			Add to Whitelist
		</button>
	</div>
{/if}

<!-- Click outside to close context menu -->
{#if contextMenuOpen}
	<button
		type="button"
		class="fixed inset-0 z-40 cursor-default"
		onclick={() => contextMenuOpen = false}
		aria-label="Close context menu"
	></button>
{/if}

<style>
	/* Enhanced filter badge animations */
	:global(.scale-105) {
		transform: scale(1.05);
	}

	:global(.hover\:scale-102:hover) {
		transform: scale(1.02);
	}

	/* Smooth transitions for all badge interactions */
	:global([data-slot="badge"]) {
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	/* Enhanced shadow for selected badges */
	:global([data-slot="badge"].shadow-lg) {
		box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
	}

	/* Subtle glow effect for selected badges */
	:global([data-slot="badge"]:has(.inline-flex)) {
		position: relative;
	}

	:global([data-slot="badge"]:has(.inline-flex)::before) {
		content: '';
		position: absolute;
		inset: -2px;
		border-radius: inherit;
		background: linear-gradient(45deg, transparent, rgba(var(--color-primary) / 0.1), transparent);
		z-index: -1;
		opacity: 0.7;
	}

	/* Enhanced pressed filter state for buttons */
	:global(.pressed-filter) {
		background: hsl(var(--primary)) !important;
		color: hsl(var(--primary-foreground)) !important;
		border-color: hsl(var(--primary)) !important;
		box-shadow: 0 0 0 2px hsl(var(--primary) / 0.3), 0 4px 12px -2px hsl(var(--primary) / 0.4) !important;
		transform: scale(1.05) !important;
		font-weight: 700 !important;
	}

	/* Additional pressed state styling for better visibility */
	:global(.pressed-filter:hover) {
		background: hsl(var(--primary) / 0.9) !important;
		transform: scale(1.05) !important;
	}

	:global(.pressed-filter:active) {
		background: hsl(var(--primary) / 0.8) !important;
		transform: scale(1.02) !important;
	}

	/* Filter button base styling */
	:global(.filter-button) {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
		position: relative;
	}

	/* Filter button states */
	:global(.filter-button:active) {
		transform: scale(0.98);
	}

	:global(.filter-button[aria-pressed="true"]) {
		background: hsl(var(--primary)) !important;
		color: hsl(var(--primary-foreground)) !important;
		border-color: hsl(var(--primary)) !important;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
		font-weight: 700 !important;
		padding-left: 0.75rem !important; /* Reduced padding */
		padding-right: 0.75rem !important;
	}

	/* Enhanced hover effects for selected elements */
	:global(.filter-button[aria-pressed="true"]:hover) {
		background: hsl(var(--primary) / 0.9) !important;
		color: hsl(var(--primary-foreground)) !important;
		box-shadow: 0 6px 8px -1px rgba(0, 0, 0, 0.15), 0 3px 6px -1px rgba(0, 0, 0, 0.1) !important;
		padding-left: 1rem !important; /* Slightly more padding on hover */
		padding-right: 1rem !important;
	}

	/* Hover scale effect */
	:global(.hover\:scale-102:hover) {
		transform: scale(1.02);
	}



	/* Selected row styling */
	:global(.table-row-selected) {
		background-color: hsl(var(--muted) / 0.3) !important;
		border-left: 2px solid hsl(var(--primary)) !important;
	}

	/* Improve table row hover and selection */
	:global(.table-row-clickable:hover) {
		background-color: hsl(var(--muted) / 0.5) !important;
	}

	:global(.table-row-clickable) {
		transition: background-color 0.2s ease, border-color 0.2s ease;
	}

	/* Column resize handles */
	:global(.resize-handle) {
		user-select: none;
		touch-action: none;
		z-index: 10;
		border: none;
		background: hsl(var(--border));
		transition: opacity 0.2s ease, background-color 0.2s ease;
	}

	:global(.resize-handle:hover) {
		opacity: 1 !important;
		background: hsl(var(--primary)) !important;
	}

	:global(.resize-handle:active) {
		background: hsl(var(--primary)) !important;
		opacity: 1 !important;
	}

	/* Prevent text selection during resize */
	:global(body.resizing) {
		user-select: none;
		cursor: col-resize;
	}

	/* Table layout for proper column sizing */
	:global([data-slot="table"]) {
		table-layout: fixed;
	}


</style>
