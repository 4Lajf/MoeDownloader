<script lang="ts">
	import { page, overlay } from '$lib/stores';
	import Home from '../views/Home.svelte';
	import Downloads from '../views/Downloads.svelte';
	import Whitelist from '../views/Whitelist.svelte';
	import DatabaseManagement from '../views/DatabaseManagement.svelte';
	import TitleOverrides from '../views/TitleOverrides.svelte';
	import Settings from '../views/Settings.svelte';
	import AniListSettings from '../views/AniListSettings.svelte';

	let { currentPage = $bindable(), currentOverlay = $bindable() } = $props();
</script>

{#if currentPage === 'home'}
	<Home />
{:else if currentPage === 'downloads'}
	<Downloads />
{:else if currentPage === 'whitelist'}
	<Whitelist />
{:else if currentPage === 'database'}
	<DatabaseManagement />
{:else if currentPage === 'title-overrides'}
	<TitleOverrides />
{:else if currentPage === 'settings'}
	<Settings />
{:else if currentPage === 'anilist'}
	<AniListSettings />
{:else}
	<Home />
{/if}
