const { get } = require('../lib/http-client');
const { configOperations, animeRelationsOperations } = require('../lib/database');

const ANIME_RELATIONS_URL = 'https://raw.githubusercontent.com/erengy/anime-relations/refs/heads/master/anime-relations.txt';

/**
 * Anime Relations Manager
 * Handles fetching, parsing, and managing anime relations data for continuous numbering schemes
 */
function createAnimeRelationsManager() {
  let relationsData = null;
  let lastFetchTime = null;
  let periodicRefreshInterval = null;

  const manager = {
    /**
     * Initialize the anime relations manager
     */
    async initialize() {
      try {
        // Load existing relations data from database
        await this.loadRelationsFromDatabase();

        // Always fetch on app startup to ensure we have the latest data with titles
        console.log('🔄 Fetching anime relations on app startup...');
        await this.fetchAndParseRelations();

        // Start periodic refresh every 12 hours
        this.startPeriodicRefresh();

        console.log('Anime relations manager initialized');
        return { success: true };
      } catch (error) {
        console.error('Failed to initialize anime relations manager:', error);
        // If fetch fails, try to use existing data
        if (relationsData) {
          console.log('Using existing anime relations data');
          return { success: true, warning: 'Failed to fetch latest data, using cached version' };
        }
        throw error;
      }
    },

    /**
     * Check if we should fetch new relations data
     */
    async shouldFetchNewData() {
      try {
        const lastFetch = configOperations.get('anime_relations_last_fetch');
        if (!lastFetch) return true;

        const lastFetchTime = new Date(lastFetch);
        const now = new Date();
        const hoursSinceLastFetch = (now - lastFetchTime) / (1000 * 60 * 60);

        // Fetch every 12 hours or if no data exists
        return hoursSinceLastFetch >= 12 || !relationsData;
      } catch (error) {
        console.error('Error checking fetch time:', error);
        return true;
      }
    },

    /**
     * Fetch and parse anime relations from the remote source
     */
    async fetchAndParseRelations() {
      try {
        console.log('Fetching anime relations data...');
        const response = await get(ANIME_RELATIONS_URL);

        const parsedData = this.parseRelationsText(response.data);
        relationsData = parsedData;

        // Save to database only
        await this.saveRelationsToDatabase(parsedData);

        // Update last fetch time
        configOperations.set('anime_relations_last_fetch', new Date().toISOString());

        console.log(`Parsed ${Object.keys(parsedData.rules).length} anime relation rules`);
        return parsedData;
      } catch (error) {
        console.error('Failed to fetch anime relations:', error);
        throw error;
      }
    },

    /**
     * Parse the anime relations text format into JSON
     */
    parseRelationsText(text) {
      const lines = text.split('\n');
      const result = {
        meta: {},
        rules: {},
        titles: {} // Store anime titles extracted from comments
      };

      let currentSection = null;
      let currentAnimeInfo = null; // Store current anime title info from comments

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines
        if (!trimmedLine) {
          continue;
        }

        // Parse anime title comments
        if (trimmedLine.startsWith('#')) {
          const titleInfo = this.parseAnimeComment(trimmedLine);
          if (titleInfo) {
            currentAnimeInfo = titleInfo;
          }
          continue;
        }

        // Section headers
        if (trimmedLine.startsWith('::')) {
          currentSection = trimmedLine.substring(2);
          continue;
        }

        // Meta section
        if (currentSection === 'meta' && trimmedLine.startsWith('-')) {
          const metaMatch = trimmedLine.match(/^-\s*([^:]+):\s*(.+)$/);
          if (metaMatch) {
            result.meta[metaMatch[1].trim()] = metaMatch[2].trim();
          }
          continue;
        }

        // Rules section
        if (currentSection === 'rules' && trimmedLine.startsWith('-')) {
          const rule = this.parseRule(trimmedLine);
          if (rule) {
            // Use AniList ID as the primary key
            const sourceAniListId = rule.source.anilistId;
            if (sourceAniListId && sourceAniListId !== '?') {
              if (!result.rules[sourceAniListId]) {
                result.rules[sourceAniListId] = [];
              }

              // Add title information to the rule if we have it
              if (currentAnimeInfo) {
                const destinationTitle = this.determineDestinationTitle(currentAnimeInfo, rule, result.rules[sourceAniListId] || []);

                rule.animeInfo = {
                  sourceTitle: currentAnimeInfo.sourceTitle,
                  destinationTitle: destinationTitle,
                  isMultiSeason: currentAnimeInfo.isMultiSeason,
                  destinations: currentAnimeInfo.destinations
                };

                // Store title mapping
                result.titles[sourceAniListId] = currentAnimeInfo.sourceTitle;
                if (rule.destination.anilistId && rule.destination.anilistId !== '?') {
                  result.titles[rule.destination.anilistId] = destinationTitle;
                }
              }

              result.rules[sourceAniListId].push(rule);
            }
          }
        }
      }

      return result;
    },

    /**
     * Parse anime title comment to extract source and destination titles
     * Examples:
     * "# Kanojo, Okarishimasu -> ~ 4th Season"
     * "# Major S1 -> ~ S2,S3,S4,S5,S6"
     * "# Maria-sama ga Miteru -> ~ Haru,3rd,4th"
     * "# Beatless -> ~: Final Stage"
     * "# Break Blade 1 -> ~ 2,3,4,5,6"
     * "# Code Geass: Boukoku no Akito 1 -> 2,3,4,5" (missing ~)
     */
    parseAnimeComment(comment) {
      try {
        // Remove the # and trim
        const content = comment.substring(1).trim();

        // Look for patterns:
        // 1. "Source Title -> ~ Destination Title(s)" (with tilde)
        // 2. "Source Title -> Destination Title(s)" (without tilde)
        const matchWithTilde = content.match(/^(.+?)\s*->\s*~\s*(.+)$/);
        const matchWithoutTilde = content.match(/^(.+?)\s*->\s*([^~].+)$/);

        const match = matchWithTilde || matchWithoutTilde;
        if (match) {
          const sourceTitle = match[1].trim();
          const destinationSuffix = match[2].trim();

          // Handle multiple destinations separated by commas
          const destinations = destinationSuffix.split(',').map(dest => dest.trim());

          // For multiple destinations, we'll store the base info and let the rule parser handle specifics
          return {
            sourceTitle,
            destinationSuffix,
            destinations,
            isMultiSeason: destinations.length > 1,
            hasTilde: !!matchWithTilde
          };
        }

        return null;
      } catch (error) {
        console.error('Error parsing anime comment:', comment, error);
        return null;
      }
    },

    /**
     * Determine the correct destination title for a rule in multi-season mappings
     */
    determineDestinationTitle(animeInfo, currentRule, existingRules) {
      if (!animeInfo.isMultiSeason) {
        // Single season mapping
        if (animeInfo.hasTilde) {
          // With tilde: prefix with source title
          // Handle special cases like "Beatless -> ~: Final Stage"
          if (animeInfo.destinationSuffix.startsWith(':')) {
            // Remove extra space before colon: "Beatless : Final Stage" -> "Beatless: Final Stage"
            return `${animeInfo.sourceTitle}${animeInfo.destinationSuffix}`;
          } else {
            return `${animeInfo.sourceTitle} ${animeInfo.destinationSuffix}`;
          }
        } else {
          // Without tilde: use destination title verbatim
          // "Kizumonogatari I: Tekketsu-hen -> Kizumonogatari II: Nekketsu-hen"
          return animeInfo.destinationSuffix;
        }
      }

      // For multi-season mappings, determine which season this rule represents
      // by counting how many rules we've seen so far for this anime
      const ruleIndex = existingRules.length; // Current rule will be the next one

      if (ruleIndex < animeInfo.destinations.length) {
        const seasonSuffix = animeInfo.destinations[ruleIndex];
        let destinationTitle;

        if (animeInfo.hasTilde) {
          // With tilde: prefix with source title
          if (this.isNumberedSeries(animeInfo.sourceTitle)) {
            // For "Break Blade 1 -> ~ 2,3,4,5,6", replace the "1" with the season number
            destinationTitle = this.replaceSeriesNumber(animeInfo.sourceTitle, seasonSuffix);
          } else if (this.hasSeasonIdentifier(animeInfo.sourceTitle)) {
            // For "Major S1 -> ~ S2,S3,S4", replace "S1" with "S2", "S3", etc.
            destinationTitle = this.replaceSeasonIdentifier(animeInfo.sourceTitle, seasonSuffix);
          } else {
            // Normal tilde case: append the suffix
            destinationTitle = `${animeInfo.sourceTitle} ${seasonSuffix}`;
          }
        } else {
          // Without tilde: use destination titles verbatim
          // For multi-season without tilde, each destination is a complete title
          destinationTitle = seasonSuffix;
        }

        return destinationTitle;
      } else {
        // Fallback if we have more rules than expected destinations
        const fallbackTitle = `${animeInfo.sourceTitle} Season ${ruleIndex + 1}`;
        return fallbackTitle;
      }
    },

    /**
     * Check if a title represents a numbered series (ends with a number)
     */
    isNumberedSeries(title) {
      return /\s+\d+$/.test(title);
    },

    /**
     * Check if a title has a season identifier (like S1, S2, Season 1, etc.)
     */
    hasSeasonIdentifier(title) {
      return /\s+S\d+$/i.test(title) || /\s+Season\s+\d+$/i.test(title);
    },

    /**
     * Replace the series number in a title
     * "Break Blade 1" + "2" -> "Break Blade 2"
     */
    replaceSeriesNumber(title, newNumber) {
      return title.replace(/\s+\d+$/, ` ${newNumber}`);
    },

    /**
     * Replace the season identifier in a title
     * "Major S1" + "S2" -> "Major S2"
     * "Major Season 1" + "Season 2" -> "Major Season 2"
     */
    replaceSeasonIdentifier(title, newSeason) {
      // Replace S1, S2, etc.
      if (/\s+S\d+$/i.test(title)) {
        return title.replace(/\s+S\d+$/i, ` ${newSeason}`);
      }
      // Replace Season 1, Season 2, etc.
      if (/\s+Season\s+\d+$/i.test(title)) {
        return title.replace(/\s+Season\s+\d+$/i, ` ${newSeason}`);
      }
      // Fallback: just append
      return `${title} ${newSeason}`;
    },

    /**
     * Parse a single rule line
     */
    parseRule(line) {
      try {
        // Remove the leading "- " and split by " -> "
        const cleanLine = line.substring(2).trim();
        const parts = cleanLine.split(' -> ');
        
        if (parts.length !== 2) {
          return null;
        }
        
        const [sourcePart, destPart] = parts;
        
        // Parse source
        const source = this.parseRulePart(sourcePart);
        if (!source) {
          return null;
        }

        // Parse destination, handling tilde (~) replacement
        const destination = this.parseRulePart(destPart, source);
        if (!destination) {
          return null;
        }

        return {
          source,
          destination,
          raw: line
        };
      } catch (error) {
        console.error('Error parsing rule:', line, error);
        return null;
      }
    },

    /**
     * Parse a rule part (source or destination)
     * @param {string} part - The rule part to parse
     * @param {object} sourceRule - The source rule (for tilde replacement in destination)
     */
    parseRulePart(part, sourceRule = null) {
      try {
        // Handle special cases
        const hasExclamation = part.endsWith('!');
        if (hasExclamation) {
          part = part.slice(0, -1);
        }
        
        // Split by colon to separate IDs from episode range
        const colonIndex = part.lastIndexOf(':');
        if (colonIndex === -1) {
          return null;
        }
        
        const idsString = part.substring(0, colonIndex);
        const episodeRange = part.substring(colonIndex + 1);
        
        // Parse IDs (MAL|Kitsu|AniList)
        let ids = idsString.split('|');
        if (ids.length !== 3) {
          return null;
        }

        // Handle tilde (~) replacement with source values
        if (sourceRule && idsString.includes('~')) {
          const originalIds = [...ids];
          ids = ids.map((id, index) => {
            if (id === '~') {
              // Replace with corresponding source ID
              switch (index) {
                case 0: return sourceRule.malId || '?';
                case 1: return sourceRule.kitsuId || '?';
                case 2: return sourceRule.anilistId || '?';
                default: return id;
              }
            }
            return id;
          });
        }

        const [malId, kitsuId, anilistId] = ids;
        
        // Parse episode range
        const episodes = this.parseEpisodeRange(episodeRange);
        
        return {
          malId: malId === '?' ? null : malId,
          kitsuId: kitsuId === '?' ? null : kitsuId,
          anilistId: anilistId === '?' ? null : anilistId,
          episodes,
          hasExclamation
        };
      } catch (error) {
        console.error('Error parsing rule part:', part, error);
        return null;
      }
    },

    /**
     * Parse episode range (e.g., "14-25", "13", "1-12")
     */
    parseEpisodeRange(rangeString) {
      try {
        if (rangeString.includes('-')) {
          const [start, end] = rangeString.split('-').map(s => s.trim());
          return {
            start: start === '?' ? null : parseInt(start),
            end: end === '?' ? 9999 : parseInt(end), // Use 9999 for open-ended ranges
            isOpenEnded: end === '?'
          };
        } else {
          const episode = rangeString === '?' ? null : parseInt(rangeString);
          return {
            start: episode,
            end: episode,
            isOpenEnded: false
          };
        }
      } catch (error) {
        console.error('Error parsing episode range:', rangeString, error);
        return null;
      }
    },

    /**
     * Load relations data from database
     */
    async loadRelationsFromDatabase() {
      try {
        const dbRelations = animeRelationsOperations.getAll();

        if (dbRelations.length === 0) {
          console.log('No existing anime relations found in database');
          relationsData = null;
          return;
        }

        // Convert database format back to our internal format
        const rules = {};
        const titles = {};

        for (const relation of dbRelations) {
          const sourceId = relation.source_anilist_id.toString();

          if (!rules[sourceId]) {
            rules[sourceId] = [];
          }

          // Store titles
          if (relation.source_anime_title) {
            titles[sourceId] = relation.source_anime_title;
          }
          if (relation.dest_anime_title) {
            titles[relation.dest_anilist_id.toString()] = relation.dest_anime_title;
          }

          // Convert back to rule format
          rules[sourceId].push({
            source: {
              anilistId: sourceId,
              malId: relation.source_mal_id?.toString() || null,
              kitsuId: relation.source_kitsu_id?.toString() || null,
              episodes: {
                start: relation.source_episode_start,
                end: relation.source_episode_end,
                isOpenEnded: relation.source_episode_end === 9999
              }
            },
            destination: {
              anilistId: relation.dest_anilist_id.toString(),
              malId: relation.dest_mal_id?.toString() || null,
              kitsuId: relation.dest_kitsu_id?.toString() || null,
              episodes: {
                start: relation.dest_episode_start,
                end: relation.dest_episode_end,
                isOpenEnded: relation.dest_episode_end === 9999
              },
              hasExclamation: relation.has_exclamation === 1
            },
            raw: relation.raw_rule,
            animeInfo: {
              sourceTitle: relation.source_anime_title,
              destinationTitle: relation.dest_anime_title
            }
          });
        }

        relationsData = {
          meta: {
            version: 'database',
            last_modified: new Date().toISOString()
          },
          rules,
          titles
        };

        console.log(`Loaded ${Object.keys(rules).length} anime relations from database`);
      } catch (error) {
        console.error('Error loading anime relations from database:', error);
        relationsData = null;
      }
    },



    /**
     * Get episode mapping for a given anime and episode number
     * @param {string} anilistId - AniList ID of the anime
     * @param {number} episodeNumber - Episode number to map
     * @returns {Object|null} - Mapped episode info or null if no mapping found
     */
    getEpisodeMapping(anilistId, episodeNumber) {
      if (!relationsData || !relationsData.rules) {
        return null;
      }
      
      const rules = relationsData.rules[anilistId];
      if (!rules) {
        return null;
      }
      
      for (const rule of rules) {
        const { source, destination } = rule;
        
        // Check if episode falls within source range
        if (source.episodes &&
            episodeNumber >= source.episodes.start &&
            episodeNumber <= source.episodes.end) {

          // Log open-ended range handling
          if (source.episodes.isOpenEnded) {
            // console.log(`📺 Open-ended range mapping: Episode ${episodeNumber} (${source.episodes.start}-?) -> ${destination.episodes.start}-?`);
          }

          // Calculate mapped episode number
          const offset = episodeNumber - source.episodes.start;
          const mappedEpisode = destination.episodes.start + offset;
          
          return {
            originalAnime: {
              anilistId: source.anilistId,
              malId: source.malId,
              kitsuId: source.kitsuId,
              title: relationsData.titles ? relationsData.titles[source.anilistId] : null
            },
            mappedAnime: {
              anilistId: destination.anilistId,
              malId: destination.malId,
              kitsuId: destination.kitsuId,
              title: relationsData.titles ? relationsData.titles[destination.anilistId] : null
            },
            originalEpisode: episodeNumber,
            mappedEpisode: mappedEpisode,
            rule: rule
          };
        }
      }
      
      return null;
    },

    /**
     * Get all relations for a given anime
     * @param {string} anilistId - AniList ID of the anime
     * @returns {Array} - Array of relation rules
     */
    getAnimeRelations(anilistId) {
      if (!relationsData || !relationsData.rules) {
        return [];
      }

      return relationsData.rules[anilistId] || [];
    },

    /**
     * Get relations data
     */
    getRelationsData() {
      return relationsData;
    },

    /**
     * Save relations data to database
     */
    async saveRelationsToDatabase(data) {
      try {
        // Clear existing relations
        animeRelationsOperations.clear();

        let savedCount = 0;
        let skippedCount = 0;

        for (const [sourceAniListId, rules] of Object.entries(data.rules)) {
          for (const rule of rules) {
            try {
              // Skip rules where essential IDs are missing
              if (!rule.destination.anilistId ||
                  rule.destination.anilistId === '?' ||
                  rule.destination.anilistId === null ||
                  !rule.source.episodes ||
                  !rule.destination.episodes ||
                  !rule.source.anilistId ||
                  rule.source.anilistId === '?' ||
                  rule.source.anilistId === null ||
                  rule.source.episodes.start === null ||
                  rule.destination.episodes.start === null) {
                console.log('Skipping rule with missing essential data:', rule.raw, {
                  sourceAnilistId: rule.source.anilistId,
                  destAnilistId: rule.destination.anilistId,
                  sourceEpisodes: rule.source.episodes,
                  destEpisodes: rule.destination.episodes
                });
                skippedCount++;
                continue;
              }

              animeRelationsOperations.add({
                source_anilist_id: parseInt(sourceAniListId),
                source_mal_id: rule.source.malId && rule.source.malId !== '?' ? parseInt(rule.source.malId) : null,
                source_kitsu_id: rule.source.kitsuId && rule.source.kitsuId !== '?' ? parseInt(rule.source.kitsuId) : null,
                source_episode_start: rule.source.episodes.start,
                source_episode_end: rule.source.episodes.end,
                dest_anilist_id: parseInt(rule.destination.anilistId),
                dest_mal_id: rule.destination.malId && rule.destination.malId !== '?' ? parseInt(rule.destination.malId) : null,
                dest_kitsu_id: rule.destination.kitsuId && rule.destination.kitsuId !== '?' ? parseInt(rule.destination.kitsuId) : null,
                dest_episode_start: rule.destination.episodes.start,
                dest_episode_end: rule.destination.episodes.end,
                has_exclamation: rule.destination.hasExclamation || false,
                raw_rule: rule.raw,
                source_anime_title: rule.animeInfo?.sourceTitle || null,
                dest_anime_title: rule.animeInfo?.destinationTitle || null
              });
              savedCount++;
            } catch (error) {
              console.error('Error saving relation rule:', rule.raw, error);
            }
          }
        }

        console.log(`Saved ${savedCount} anime relations to database (skipped ${skippedCount} rules with unknown episode ranges)`);
      } catch (error) {
        console.error('Failed to save anime relations to database:', error);
      }
    },

    /**
     * Force refresh relations data
     */
    async forceRefresh() {
      await this.fetchAndParseRelations();
    },

    /**
     * Start periodic refresh every 12 hours
     */
    startPeriodicRefresh() {
      // Clear any existing interval
      if (periodicRefreshInterval) {
        clearInterval(periodicRefreshInterval);
      }

      // Set up new interval for 12 hours (12 * 60 * 60 * 1000 ms)
      periodicRefreshInterval = setInterval(async () => {
        try {
          console.log('🔄 Periodic anime relations refresh (12-hour interval)...');
          await this.fetchAndParseRelations();
          console.log('✅ Periodic anime relations refresh completed');
        } catch (error) {
          console.error('❌ Periodic anime relations refresh failed:', error);
        }
      }, 12 * 60 * 60 * 1000);

      console.log('📅 Periodic anime relations refresh scheduled every 12 hours');
    },

    /**
     * Stop periodic refresh
     */
    stopPeriodicRefresh() {
      if (periodicRefreshInterval) {
        clearInterval(periodicRefreshInterval);
        periodicRefreshInterval = null;
        console.log('🛑 Periodic anime relations refresh stopped');
      }
    },

    /**
     * Cleanup resources
     */
    cleanup() {
      this.stopPeriodicRefresh();
    },

    /**
     * Check if an anime has any relations
     * @param {string} anilistId - AniList ID of the anime
     * @returns {boolean} - True if anime has relations
     */
    hasRelations(anilistId) {
      if (!relationsData || !relationsData.rules) {
        return false;
      }

      return !!(relationsData.rules[anilistId] && relationsData.rules[anilistId].length > 0);
    },

    /**
     * Get reverse mapping - find which anime an episode should map back to
     * @param {string} anilistId - AniList ID of the destination anime
     * @param {number} episodeNumber - Episode number in the destination anime
     * @returns {Object|null} - Original anime info or null if no mapping found
     */
    getReverseMapping(anilistId, episodeNumber) {
      if (!relationsData || !relationsData.rules) {
        return null;
      }

      // Search through all rules to find reverse mappings
      for (const [sourceId, rules] of Object.entries(relationsData.rules)) {
        for (const rule of rules) {
          const { destination } = rule;

          // Check if this rule maps to our target anime
          if (destination.anilistId === anilistId && destination.episodes) {
            // Check if episode falls within destination range
            if (episodeNumber >= destination.episodes.start &&
                episodeNumber <= destination.episodes.end) {

              // Calculate original episode number
              const offset = episodeNumber - destination.episodes.start;
              const originalEpisode = rule.source.episodes.start + offset;

              return {
                originalAnime: {
                  anilistId: rule.source.anilistId,
                  malId: rule.source.malId,
                  kitsuId: rule.source.kitsuId
                },
                mappedAnime: {
                  anilistId: destination.anilistId,
                  malId: destination.malId,
                  kitsuId: destination.kitsuId
                },
                originalEpisode: originalEpisode,
                mappedEpisode: episodeNumber,
                rule: rule
              };
            }
          }
        }
      }

      return null;
    }
  };

  return manager;
}

module.exports = { createAnimeRelationsManager };
