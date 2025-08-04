// ES6 wrapper for title overrides functionality
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { createTitleOverridesManager } = require('../electron/services/title-overrides');

// Create a singleton instance
let titleOverridesManager = null;

/**
 * Initialize the title overrides manager
 */
export async function initializeTitleOverrides() {
  if (!titleOverridesManager) {
    titleOverridesManager = createTitleOverridesManager();
    await titleOverridesManager.initialize();
  }
  return titleOverridesManager;
}

/**
 * Apply title overrides to a given title
 * @param {string} originalTitle - The original title to transform
 * @param {Object} [options={}] - Additional options for override application
 * @param {string} [options.releaseGroup] - The release group (e.g., 'SubsPlease', 'Erai-raws')
 * @param {number} [options.anilistId] - The AniList ID if known
 * @param {number} [options.episodeNumber] - The episode number for episode overrides
 * @returns {string} - The transformed title or original if no override applies
 */
export function applyTitleOverrides(originalTitle, options = {}) {
  if (!titleOverridesManager) {
    console.warn('⚠️  Title overrides manager not initialized, returning original title');
    return originalTitle;
  }

  return titleOverridesManager.applyOverrides(originalTitle, options);
}

/**
 * Apply episode mappings (can change both title and episode number)
 * @param {string} animeTitle - The anime title (after title overrides)
 * @param {number} episodeNumber - The original episode number
 * @returns {Object} - Object with transformedTitle and transformedEpisode
 */
export function applyEpisodeMappings(animeTitle, episodeNumber) {
  if (!titleOverridesManager) {
    console.warn('⚠️  Title overrides manager not initialized, returning original values');
    return { transformedTitle: animeTitle, transformedEpisode: episodeNumber };
  }

  return titleOverridesManager.applyEpisodeMappings(animeTitle, episodeNumber);
}

/**
 * Apply episode number overrides (legacy method for backward compatibility)
 * @param {string} animeTitle - The anime title (after title overrides)
 * @param {number} episodeNumber - The original episode number
 * @returns {number} - The transformed episode number or original if no override applies
 */
export function applyEpisodeOverrides(animeTitle, episodeNumber) {
  if (!titleOverridesManager) {
    console.warn('⚠️  Title overrides manager not initialized, returning original episode number');
    return episodeNumber;
  }

  return titleOverridesManager.applyEpisodeOverrides(animeTitle, episodeNumber);
}

/**
 * Get the title overrides manager instance
 */
export function getTitleOverridesManager() {
  return titleOverridesManager;
}

/**
 * Force refresh title overrides
 */
export async function refreshTitleOverrides() {
  if (titleOverridesManager) {
    return await titleOverridesManager.forceRefresh();
  }
  return null;
}

/**
 * Extract release group from a title string
 * @param {string} title - The title string to extract release group from
 * @returns {string|null} - The release group or null if not found
 */
export function extractReleaseGroup(title) {
  if (!title) return null;
  
  // Common release group patterns
  const patterns = [
    /\[([^\]]+)\]/,  // [GroupName]
    /\(([^)]+)\)/,   // (GroupName)
  ];
  
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      const group = match[1].trim();
      // Filter out common non-group tags
      if (!['1080p', '720p', '480p', 'HEVC', 'x264', 'x265', 'AAC', 'FLAC', 'MP3'].includes(group)) {
        return group;
      }
    }
  }
  
  return null;
}
