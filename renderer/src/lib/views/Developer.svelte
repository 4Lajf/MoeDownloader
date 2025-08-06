<script lang="ts">
	import { onMount } from 'svelte';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { RefreshCw, ChevronDown, ChevronRight, TestTube, Download } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ipc from '../../ipc';

	let testRssUrl = $state('');
	let testResults = $state<any[]>([]);
	let showResults = $state(false);
	let testInProgress = $state(false);
	let downloadTestInProgress = $state(false);
	let advancedSettingsOpen = $state(false);

	// Settings for advanced torrent configuration
	let settings = $state({
		torrentPort: 6881,
		enableDHT: true,
		enablePEX: true,
		enableLSD: true
	});

	onMount(async () => {
		await loadSettings();
	});

	async function loadSettings() {
		try {
			const appSettings = await ipc.getSettings();
			settings = {
				torrentPort: parseInt(appSettings.torrent_port) || settings.torrentPort,
				enableDHT: appSettings.enable_dht !== undefined ? appSettings.enable_dht : settings.enableDHT,
				enablePEX: appSettings.enable_pex !== undefined ? appSettings.enable_pex : settings.enablePEX,
				enableLSD: appSettings.enable_lsd !== undefined ? appSettings.enable_lsd : settings.enableLSD
			};
		} catch (error: any) {
			console.error('Error loading settings:', error);
		}
	}

	async function saveSettings() {
		try {
			const settingsToSave = {
				torrent_port: settings.torrentPort,
				enable_dht: settings.enableDHT,
				enable_pex: settings.enablePEX,
				enable_lsd: settings.enableLSD
			};
			await ipc.saveSettings(settingsToSave);
			toast.success('Settings saved', {
				description: 'Advanced settings have been saved.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error saving settings:', error);
			toast.error('Failed to save settings', {
				description: `Error: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function testContinuousNumeration() {
		if (!testRssUrl.trim()) {
			toast.error('Invalid RSS URL', {
				description: 'Please enter a valid RSS feed URL.',
				duration: 3000
			});
			return;
		}

		try {
			testInProgress = true;
			showResults = false;
			testResults = [];

			toast.loading('Testing continuous numeration...', {
				description: 'Parsing RSS feed and checking episode numbering.',
				duration: 15000
			});

			const result = await ipc.testRSSContinuousNumeration(testRssUrl);

			toast.dismiss();

			if (result.success) {
				testResults = result.results || [];
				showResults = true;
				toast.success('RSS test completed', {
					description: `Processed ${testResults.length} items from the RSS feed.`,
					duration: 4000
				});
			} else {
				toast.error('RSS test failed', {
					description: result.error || 'Unknown error occurred during testing.',
					duration: 5000
				});
			}
		} catch (error: any) {
			console.error('Error testing RSS continuous numeration:', error);
			toast.dismiss();
			toast.error('RSS test failed', {
				description: `Test failed: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			testInProgress = false;
		}
	}

	async function testRSSDownload() {
		if (!testRssUrl.trim()) {
			toast.error('Invalid RSS URL', {
				description: 'Please enter a valid RSS feed URL.',
				duration: 3000
			});
			return;
		}

		try {
			downloadTestInProgress = true;

			toast.loading('Testing RSS download...', {
				description: 'Processing RSS feed and testing download functionality.',
				duration: 30000
			});

			const result = await ipc.testRSSDownload(testRssUrl);

			toast.dismiss();

			if (result.success) {
				toast.success('RSS download test completed', {
					description: `Test completed. Check the results for details.`,
					duration: 4000
				});
			} else {
				toast.error('RSS download test failed', {
					description: result.error || 'Unknown error occurred during testing.',
					duration: 5000
				});
			}
		} catch (error: any) {
			console.error('Error testing RSS download:', error);
			toast.dismiss();
			toast.error('RSS download test failed', {
				description: `Test failed: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			downloadTestInProgress = false;
		}
	}
</script>

<div class="p-6">
	<div class="mb-6">
		<h1 class="text-3xl font-bold">Developer Tools</h1>
		<p class="text-muted-foreground">Advanced debugging and testing tools for developers</p>
	</div>

	<div class="space-y-6">
		<!-- RSS Testing & Debugging -->
		<Card>
			<CardHeader>
				<CardTitle>RSS Testing & Debugging</CardTitle>
				<CardDescription>Test RSS feed parsing and download functionality</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div>
					<Label for="testRssUrl" class="py-2">Test RSS URL</Label>
					<Input
						id="testRssUrl"
						bind:value={testRssUrl}
						placeholder="https://nyaa.si/?page=rss&q=anime+title"
						type="url"
					/>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<Button variant="outline-info" onclick={testContinuousNumeration} disabled={testInProgress || downloadTestInProgress}>
						{#if testInProgress}
							<RefreshCw class="w-4 h-4 mr-2 animate-spin" />
							Testing...
						{:else}
							<TestTube class="w-4 h-4 mr-2" />
							Test Continuous Numeration
						{/if}
					</Button>
					<Button variant="outline-purple" onclick={testRSSDownload} disabled={testInProgress || downloadTestInProgress}>
						{#if downloadTestInProgress}
							<RefreshCw class="w-4 h-4 mr-2 animate-spin" />
							Testing...
						{:else}
							<Download class="w-4 h-4 mr-2" />
							Test RSS Download
						{/if}
					</Button>
				</div>

				{#if showResults && testResults.length > 0}
					<div class="mt-4 space-y-2">
						<h4 class="font-medium">Test Results:</h4>
						<div class="max-h-96 overflow-y-auto space-y-2">
							{#each testResults as result, index}
								<div class="border rounded p-3 text-sm">
									<div class="font-medium mb-2">Item {index + 1}: {result.title}</div>
									
									{#if result.status === 'processed'}
										<div class="text-green-600 mb-2">✅ Successfully processed</div>
									{:else if result.status === 'no_match'}
										<div class="text-red-600 mb-2">❌ No whitelist match</div>
									{:else if result.status === 'skipped'}
										<div class="text-yellow-600 mb-2">⏭️ Skipped (already processed)</div>
									{:else}
										<div class="text-gray-600 mb-2">ℹ️ {result.status}</div>
									{/if}

									{#if result.titleOverridesResult}
										<div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-800/30 rounded p-3">
											<div class="font-medium text-blue-800 dark:text-blue-200 text-sm mb-2">🎯 Title Overrides System</div>
											{#if result.titleOverridesResult.error}
												<p class="text-sm text-red-600">Error: {result.titleOverridesResult.error}</p>
											{:else}
												<div class="space-y-2 text-sm">
													{#if result.titleOverridesResult.titleChanged}
														<div class="space-y-1">
															<div class="font-medium text-blue-700 dark:text-blue-300">Title Override Applied:</div>
															<div class="font-mono text-xs">
																<span class="text-red-600">Original:</span> {result.titleOverridesResult.originalTitle}
															</div>
															<div class="font-mono text-xs">
																<span class="text-green-600">Override:</span> {result.titleOverridesResult.overrideTitle}
															</div>
														</div>
													{/if}
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Advanced Settings -->
		<Card>
			<CardHeader>
				<CardTitle>Advanced Settings</CardTitle>
				<CardDescription>Advanced torrent and network configuration</CardDescription>
			</CardHeader>
			<CardContent>
				<Collapsible.Root bind:open={advancedSettingsOpen}>
					<Collapsible.Trigger class="flex items-center justify-between w-full p-2 text-left hover:bg-muted rounded">
						<span class="font-medium">Torrent Settings</span>
						{#if advancedSettingsOpen}
							<ChevronDown class="w-4 h-4" />
						{:else}
							<ChevronRight class="w-4 h-4" />
						{/if}
					</Collapsible.Trigger>
					<Collapsible.Content class="space-y-4 pt-4">
						<div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/30 rounded-lg p-3 mb-4">
							<p class="text-sm text-yellow-800 dark:text-yellow-200">
								⚠️ <strong>Warning:</strong> These are advanced settings. Only modify them if you understand their impact on torrent performance and network behavior.
							</p>
						</div>

						<div>
							<Label for="torrentPort" class="py-2">Torrent Port</Label>
							<Input
								id="torrentPort"
								bind:value={settings.torrentPort}
								type="number"
								min="1024"
								max="65535"
								placeholder="6881"
							/>
							<p class="text-xs text-muted-foreground mt-1">Port used for torrent connections (1024-65535)</p>
						</div>

						<div class="flex items-center space-x-2">
							<Switch
								id="dht"
								bind:checked={settings.enableDHT}
							/>
							<div>
								<Label for="dht">Enable DHT (Distributed Hash Table)</Label>
								<p class="text-xs text-muted-foreground">Helps find peers without trackers</p>
							</div>
						</div>

						<div class="flex items-center space-x-2">
							<Switch
								id="pex"
								bind:checked={settings.enablePEX}
							/>
							<div>
								<Label for="pex">Enable PEX (Peer Exchange)</Label>
								<p class="text-xs text-muted-foreground">Allows peers to share information about other peers</p>
							</div>
						</div>

						<div class="flex items-center space-x-2">
							<Switch
								id="lsd"
								bind:checked={settings.enableLSD}
							/>
							<div>
								<Label for="lsd">Enable LSD (Local Service Discovery)</Label>
								<p class="text-xs text-muted-foreground">Discovers peers on the local network</p>
							</div>
						</div>

						<Button variant="success" onclick={saveSettings} class="mt-4">
							Save Advanced Settings
						</Button>
					</Collapsible.Content>
				</Collapsible.Root>
			</CardContent>
		</Card>
	</div>
</div>
