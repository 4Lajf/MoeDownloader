<script lang="ts">

	import Home from '../views/Home.svelte';
	import Downloads from '../views/Downloads.svelte';
	import Search from '../views/Search.svelte';
	import Whitelist from '../views/Whitelist.svelte';
	import DatabaseManagement from '../views/DatabaseManagement.svelte';
	import TitleOverrides from '../views/TitleOverrides.svelte';
	import ActivityLogs from '../views/ActivityLogs.svelte';
	import Settings from '../views/Settings.svelte';
	import AniListSettings from '../views/AniListSettings.svelte';
	import Developer from '../views/Developer.svelte';

	let { currentPage = $bindable(), currentOverlay = $bindable() } = $props();
</script>

{#if currentPage === 'home'}
	<Home />
{:else if currentPage === 'downloads'}
	<Downloads />
{:else if currentPage === 'search'}
	<Search />
{:else if currentPage === 'whitelist'}
	<Whitelist />
{:else if currentPage === 'database'}
	<DatabaseManagement />
{:else if currentPage === 'title-overrides'}
	<TitleOverrides />
{:else if currentPage === 'activity-logs'}
	<ActivityLogs />
{:else if currentPage === 'settings'}
	<Settings />
{:else if currentPage === 'anilist'}
	<AniListSettings />
{:else if currentPage === 'developer'}
	<Developer />
{:else}
	<Home />
{/if}
