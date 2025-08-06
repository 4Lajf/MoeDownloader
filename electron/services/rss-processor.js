const axios = require('axios');
const xml2js = require('xml2js');
const {
  whitelistOperations,
  downloadOperations,
  rssOperations,
  configOperations,
  anilistAnimeCacheOperations,
  processedFilesOperations,
  processedGuidsOperations
} = require("../lib/database");
const { parseFilename } = require('../lib/filename-parser');
const { createAnimeRelationsManager } = require('./anime-relations');
const { createTitleOverridesManager } = require('./title-overrides');
const { ALLOWED_FANSUB_GROUPS } = require('../lib/constants');
const { getDatabase } = require('../lib/database');

function createRSSProcessor(notificationService = null, anilistService = null, activityLogger = null) {
  let animeRelationsManager = null;
  let titleOverridesManager = null;

  const processor = {
    async initialize() {
      try {
        animeRelationsManager = createAnimeRelationsManager();
        await animeRelationsManager.initialize();

        titleOverridesManager = createTitleOverridesManager();
        await titleOverridesManager.initialize();

        console.log('RSS processor initialized');
      } catch (error) {
        console.error('Failed to initialize RSS processor:', error);
      }
    },



    /**
     * Check if a fansub group is globally blacklisted
     * @param {string} releaseGroup - The release group name
     * @param {string} preferredGroup - The preferred group from whitelist entry (for override)
     * @returns {boolean} - True if group is blacklisted and not overridden
     */
    isGroupBlacklisted(releaseGroup, preferredGroup = null) {
      try {
        if (!releaseGroup) return false;

        const disabledGroups = configOperations.get('disabled_fansub_groups') || '';
        if (!disabledGroups) return false;

        const blacklistedGroups = disabledGroups.split(',').map(g => g.trim().toLowerCase()).filter(g => g);
        const isBlacklisted = blacklistedGroups.includes(releaseGroup.toLowerCase());

        // Check for manual override - if the whitelist entry specifically sets this group, allow it
        if (isBlacklisted && preferredGroup && preferredGroup !== 'any') {
          const isOverridden = preferredGroup.toLowerCase() === releaseGroup.toLowerCase();
          if (isOverridden) {
            console.log(`🔓 RSS: Group "${releaseGroup}" is blacklisted but overridden by whitelist entry`);
            return false;
          }
        }

        if (isBlacklisted) {
          console.log(`🚫 RSS: Group "${releaseGroup}" is globally blacklisted`);
        }

        return isBlacklisted;
      } catch (error) {
        console.error('❌ RSS: Error checking group blacklist:', error);
        return false; // If there's an error, don't filter out
      }
    },

    /**
     * Check if a fansub group is in the allowed list
     * @param {string} releaseGroup - The release group name
     * @returns {boolean} - True if group is allowed
     */
    isGroupAllowed(releaseGroup) {
      if (!releaseGroup) {
        return false;
      }

      // Check if the group is in our allowed list
      const isAllowed = ALLOWED_FANSUB_GROUPS.includes(releaseGroup);

      return isAllowed;
    },

    /**
     * Normalize anime title for consistent duplicate detection
     * @param {string} title - The anime title to normalize
     * @returns {string} - Normalized title
     */
    normalizeAnimeTitle(title) {
      if (!title) return '';

      // Remove punctuation, convert to lowercase, normalize whitespace
      return title
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove all punctuation
        .replace(/\s+/g, ' ')    // Normalize whitespace
        .trim();
    },

    /**
     * Get all possible title variations for an anime (including English title and synonyms)
     * @param {string} animeTitle - The parsed anime title
     * @param {Object} whitelistEntry - The matched whitelist entry
     * @returns {Array<string>} - Array of normalized title variations
     */
    getAnimeTitleVariations(animeTitle, whitelistEntry) {
      const variations = new Set();

      // Add the parsed title
      if (animeTitle) {
        variations.add(this.normalizeAnimeTitle(animeTitle));
      }

      // Add whitelist entry title
      if (whitelistEntry?.title) {
        variations.add(this.normalizeAnimeTitle(whitelistEntry.title));
      }

      // If this is an AniList entry, get cached anime data for more title variations
      if (whitelistEntry?.source_type === 'anilist' && whitelistEntry?.anilist_id) {
        try {
          const cachedAnime = anilistAnimeCacheOperations.getByAnilistId(whitelistEntry.anilist_id);
          if (cachedAnime && cachedAnime.anime_data && cachedAnime.anime_data !== 'undefined') {
            const animeData = JSON.parse(cachedAnime.anime_data);

            // Add romaji title
            if (animeData.title?.romaji) {
              variations.add(this.normalizeAnimeTitle(animeData.title.romaji));
            }

            // Add English title
            if (animeData.title?.english) {
              variations.add(this.normalizeAnimeTitle(animeData.title.english));
            }

            // Add native title
            if (animeData.title?.native) {
              variations.add(this.normalizeAnimeTitle(animeData.title.native));
            }

            // Add synonyms
            if (animeData.synonyms && Array.isArray(animeData.synonyms)) {
              animeData.synonyms.forEach(synonym => {
                if (synonym) {
                  variations.add(this.normalizeAnimeTitle(synonym));
                }
              });
            }
          }
        } catch (error) {
          console.log(`⚠️  RSS: Could not get AniList title variations for AniList ID ${whitelistEntry.anilist_id}:`, error.message);
          console.log(`💡 RSS: This might be due to corrupted cache data. Consider refreshing AniList cache.`);
        }
      }

      return Array.from(variations).filter(title => title.length > 0);
    },

    /**
     * Check if episode exists using any title variation
     * @param {string} episodeNumber - Episode number
     * @param {Array<string>} titleVariations - Array of normalized title variations
     * @returns {boolean} - True if episode exists for any title variation
     */
    checkEpisodeExistsAnyVariation(episodeNumber, titleVariations) {
      for (const titleVariation of titleVariations) {
        if (processedFilesOperations.exists(episodeNumber, titleVariation)) {
          console.log(`🔍 RSS: Found existing episode for title variation: "${titleVariation}"`);
          return true;
        }
      }
      return false;
    },

    /**
     * Check if episode is queued using any title variation
     * @param {string} episodeNumber - Episode number
     * @param {Array<string>} titleVariations - Array of normalized title variations
     * @returns {Object|null} - Existing download object if found, null otherwise
     */
    checkEpisodeQueuedAnyVariation(episodeNumber, titleVariations) {
      const allDownloads = downloadOperations.getAll();

      for (const download of allDownloads) {
        if (download.status !== 'queued' && download.status !== 'downloading') {
          continue;
        }

        const existingParsedData = parseFilename(download.torrent_title);
        const existingEpisodeNumber = existingParsedData?.episodeNumber || '';
        const existingAnimeTitle = existingParsedData?.animeTitle || '';

        if (existingEpisodeNumber === episodeNumber) {
          const normalizedExistingTitle = this.normalizeAnimeTitle(existingAnimeTitle);

          // Check if any of our title variations match the existing download
          for (const titleVariation of titleVariations) {
            if (titleVariation === normalizedExistingTitle) {
              console.log(`🔍 RSS: Found queued episode for title variation: "${titleVariation}" (existing: "${normalizedExistingTitle}")`);
              return download;
            }
          }
        }
      }

      return null;
    },

    /**
     * Get the highest episode number already processed or queued for an anime
     * @param {Array<string>} titleVariations - Array of normalized title variations
     * @returns {number} - Highest episode number found, or 0 if none
     */
    getHighestProcessedEpisode(titleVariations) {
      let highestEpisode = 0;

      // Check processed files database
      const db = getDatabase();
      for (const titleVariation of titleVariations) {
        try {
          const stmt = db.prepare(`
            SELECT episode_number FROM processed_files
            WHERE anime_title = ? AND episode_number IS NOT NULL
            ORDER BY CAST(episode_number AS INTEGER) DESC
            LIMIT 1
          `);
          const result = stmt.get(titleVariation);
          if (result && result.episode_number) {
            const episodeNum = parseInt(result.episode_number) || 0;
            highestEpisode = Math.max(highestEpisode, episodeNum);
          }
        } catch (error) {
          console.log(`⚠️  RSS: Error checking processed episodes for "${titleVariation}":`, error.message);
        }
      }

      // Check queued downloads
      const allDownloads = downloadOperations.getAll();
      for (const download of allDownloads) {
        if (download.status !== 'queued' && download.status !== 'downloading') {
          continue;
        }

        const existingParsedData = parseFilename(download.torrent_title);
        const existingEpisodeNumber = existingParsedData?.episodeNumber || '';
        const existingAnimeTitle = existingParsedData?.animeTitle || '';
        const normalizedExistingTitle = this.normalizeAnimeTitle(existingAnimeTitle);

        // Check if any of our title variations match the existing download
        for (const titleVariation of titleVariations) {
          if (titleVariation === normalizedExistingTitle && existingEpisodeNumber) {
            const episodeNum = parseInt(existingEpisodeNumber) || 0;
            highestEpisode = Math.max(highestEpisode, episodeNum);
            break;
          }
        }
      }

      return highestEpisode;
    },

    /**
     * Select the latest episode for each anime from download candidates
     * Only selects episodes that are newer than what's already processed/queued
     * @param {Array} candidates - Array of download candidates
     * @returns {Array} - Array of selected candidates (latest episode per anime)
     */
    selectLatestEpisodes(candidates) {
      if (candidates.length === 0) return [];

      // Group candidates by normalized anime title
      const animeGroups = new Map();

      for (const candidate of candidates) {
        const key = candidate.primaryNormalizedTitle;
        if (!animeGroups.has(key)) {
          animeGroups.set(key, []);
        }
        animeGroups.get(key).push(candidate);
      }

      const selectedCandidates = [];

      // For each anime, select the candidate with the highest episode number
      // that's newer than what's already processed/queued
      for (const [animeTitle, animeCandidates] of animeGroups) {
        console.log(`🎯 RSS: Selecting from ${animeCandidates.length} candidates for "${animeTitle}"`);

        // Get the highest episode already processed/queued for this anime
        const titleVariations = animeCandidates[0].titleVariations;
        const highestProcessedEpisode = this.getHighestProcessedEpisode(titleVariations);

        console.log(`📊 RSS: Checking episode progression for "${animeTitle}"`);
        console.log(`📊 RSS: Title variations being checked:`, titleVariations);
        console.log(`📊 RSS: Highest processed episode: ${highestProcessedEpisode}`);
        console.log(`📊 RSS: Available candidates:`, animeCandidates.map(c => `Episode ${c.episodeNumber} [${c.releaseGroup}]`));

        // Filter candidates to only include episodes newer than what's already processed
        const validCandidates = animeCandidates.filter(candidate => {
          const episodeNum = parseInt(candidate.episodeNumber) || 0;
          const isNewer = episodeNum > highestProcessedEpisode;

          if (!isNewer && highestProcessedEpisode > 0) {
            console.log(`⏭️  RSS: Skipping Episode ${candidate.episodeNumber} [${candidate.releaseGroup}] (not newer than processed episode ${highestProcessedEpisode})`);
          }

          return isNewer;
        });

        if (validCandidates.length === 0) {
          console.log(`⏭️  RSS: No new episodes found for "${animeTitle}" (all episodes are older than or equal to processed episodes)`);
          continue;
        }

        // Sort valid candidates by episode number (descending) to get the latest episode first
        const sortedCandidates = validCandidates.sort((a, b) => {
          const episodeA = parseInt(a.episodeNumber) || 0;
          const episodeB = parseInt(b.episodeNumber) || 0;
          return episodeB - episodeA;
        });

        // Select the latest episode (first after sorting)
        const selected = sortedCandidates[0];
        selectedCandidates.push(selected);

        console.log(`🎯 RSS: Selected Episode ${selected.episodeNumber} [${selected.releaseGroup}] for "${animeTitle}"`);

        // Log skipped candidates
        if (sortedCandidates.length > 1) {
          const skipped = sortedCandidates.slice(1);
          for (const skippedCandidate of skipped) {
            console.log(`⏭️  RSS: Skipped Episode ${skippedCandidate.episodeNumber} [${skippedCandidate.releaseGroup}] (older than selected episode)`);
          }
        }
      }

      return selectedCandidates;
    },

    async processFeed(rssUrl) {
      try {
        // Fetch RSS feed
        const response = await axios.get(rssUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'MoeDownloader/1.0'
          }
        });

        // Parse XML
        const parser = new xml2js.Parser();
        const parsedResult = await parser.parseStringPromise(response.data);

        if (!parsedResult.rss || !parsedResult.rss.channel || !parsedResult.rss.channel[0].item) {
          throw new Error('Invalid RSS feed format');
        }

        const items = parsedResult.rss.channel[0].item;
        console.log(`📡 RSS: Found ${items.length} items in feed`);

        let processedCount = 0;
        let downloadedCount = 0;

        // Get whitelist entries
        const whitelistEntries = whitelistOperations.getAll().filter(entry => entry.enabled);
        if (whitelistEntries.length === 0) {
          console.log('⚠️  RSS: No whitelist entries found, skipping processing');
          return {
            success: true,
            processed: 0,
            downloaded: 0,
            message: 'No whitelist entries configured'
          };
        }

        // Phase 1: Collect all download candidates
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📋 RSS: Phase 1 - Collecting download candidates...`);
        console.log(`${'='.repeat(80)}`);

        const downloadCandidates = [];

        for (const item of items) {
          try {
            const guid = item.guid?.[0]?._ || item.guid?.[0] || item.link?.[0];
            const title = item.title?.[0] || '';
            const link = item.link?.[0] || '';
            const pubDate = item.pubDate?.[0] || '';



            if (!guid || !title || !link) {
              continue;
            }

            // Check if this GUID was already processed
            if (processedGuidsOperations.exists(guid)) {
              continue;
            }

            // Mark GUID as processed
            processedGuidsOperations.add(guid);
            processedCount++;

            // Add to RSS entries for tracking
            const rssResult = rssOperations.add(null, guid, title, link, pubDate);
            const rssId = rssResult.lastInsertRowid;

            // First, parse the filename to get release group info
            const parsedData = parseFilename(title);
            const releaseGroup = parsedData?.releaseGroup;

            // Check if the release group is in our allowed list BEFORE checking whitelist
            if (!this.isGroupAllowed(releaseGroup)) {
              continue; // Skip silently for disallowed groups
            }

            // Check against whitelist with enhanced matching
            const matchResult = await this.findMatchingWhitelistEntry(title, whitelistEntries);
            if (matchResult.entry) {
              // IMPORTANT: Apply anime relations and episode mapping BEFORE duplicate checks
              let episodeNumber = matchResult.parsedData?.episodeNumber || '';
              let animeTitle = matchResult.parsedData?.animeTitle || matchResult.entry.title;
              let mappedEpisodeNumber = episodeNumber;
              let mappedAnimeTitle = animeTitle;

              // Apply anime relations episode mapping if available
              console.log(`🔍 RSS: Checking anime relations for "${animeTitle}" Episode ${episodeNumber}`);
              console.log(`🔍 RSS: Whitelist entry AniList ID: ${matchResult.entry.anilist_id}`);
              console.log(`🔍 RSS: Anime relations manager available: ${!!animeRelationsManager}`);

              if (animeRelationsManager && episodeNumber && matchResult.entry.anilist_id) {
                try {
                  const mapping = animeRelationsManager.getEpisodeMapping(matchResult.entry.anilist_id, parseInt(episodeNumber));
                  console.log(`🔍 RSS: Episode mapping result:`, mapping);

                  if (mapping) {
                    mappedEpisodeNumber = mapping.mappedEpisode.toString();
                    // Try to get the mapped anime title
                    if (mapping.mappedAnime.title) {
                      mappedAnimeTitle = mapping.mappedAnime.title;
                    }
                    console.log(`🔄 RSS: Applied episode mapping: "${animeTitle}" Episode ${episodeNumber} → "${mappedAnimeTitle}" Episode ${mappedEpisodeNumber}`);
                    console.log(`🔄 RSS: Mapping details:`, {
                      originalAnime: mapping.originalAnime,
                      mappedAnime: mapping.mappedAnime,
                      originalEpisode: mapping.originalEpisode,
                      mappedEpisode: mapping.mappedEpisode
                    });
                  } else {
                    console.log(`🔍 RSS: No episode mapping found for AniList ID ${matchResult.entry.anilist_id} Episode ${episodeNumber}`);
                  }
                } catch (error) {
                  console.error('❌ RSS: Error applying anime relations mapping:', error);
                }
              } else {
                if (!animeRelationsManager) {
                  console.log(`⚠️  RSS: Anime relations manager not available`);
                }
                if (!episodeNumber) {
                  console.log(`⚠️  RSS: No episode number available for mapping`);
                }
                if (!matchResult.entry.anilist_id) {
                  console.log(`⚠️  RSS: No AniList ID available for "${animeTitle}" - this is likely a manual whitelist entry`);
                  console.log(`💡 RSS: Consider using AniList auto-sync to get episode mapping support`);
                }
              }

              // Apply title overrides and episode mappings
              if (titleOverridesManager) {
                try {
                  // Apply title overrides
                  const overriddenTitle = titleOverridesManager.applyOverrides(mappedAnimeTitle);
                  if (overriddenTitle !== mappedAnimeTitle) {
                    mappedAnimeTitle = overriddenTitle;
                    console.log(`🔄 RSS: Applied title override: "${animeTitle}" → "${mappedAnimeTitle}"`);
                  }

                  // Apply episode mappings
                  if (mappedEpisodeNumber) {
                    const episodeMappingResult = titleOverridesManager.applyEpisodeMappings(mappedAnimeTitle, parseInt(mappedEpisodeNumber));
                    if (episodeMappingResult && (
                      episodeMappingResult.transformedTitle !== mappedAnimeTitle ||
                      episodeMappingResult.transformedEpisode !== parseInt(mappedEpisodeNumber)
                    )) {
                      mappedAnimeTitle = episodeMappingResult.transformedTitle;
                      mappedEpisodeNumber = episodeMappingResult.transformedEpisode.toString();
                      console.log(`🔄 RSS: Applied episode mapping: Episode ${episodeNumber} → Episode ${mappedEpisodeNumber}, Title: "${animeTitle}" → "${mappedAnimeTitle}"`);
                    }
                  }
                } catch (error) {
                  console.error('❌ RSS: Error applying title overrides:', error);
                }
              }

              // Get all possible title variations using the MAPPED title (including English title and synonyms)
              const titleVariations = this.getAnimeTitleVariations(mappedAnimeTitle, matchResult.entry);
              const primaryNormalizedTitle = titleVariations[0] || this.normalizeAnimeTitle(mappedAnimeTitle);

              // Check if this MAPPED episode was already processed or queued
              const alreadyProcessed = this.checkEpisodeExistsAnyVariation(mappedEpisodeNumber, titleVariations);
              const existingQueuedDownload = this.checkEpisodeQueuedAnyVariation(mappedEpisodeNumber, titleVariations);

              if (!alreadyProcessed && !existingQueuedDownload) {
                // Add to candidates for later processing (using MAPPED information)
                downloadCandidates.push({
                  rssId,
                  guid,
                  title,
                  link,
                  pubDate,
                  matchResult,
                  // Store both original and mapped information
                  originalEpisodeNumber: episodeNumber,
                  originalAnimeTitle: animeTitle,
                  episodeNumber: mappedEpisodeNumber,  // Use mapped episode number
                  animeTitle: mappedAnimeTitle,        // Use mapped anime title
                  primaryNormalizedTitle,
                  titleVariations,
                  releaseGroup,
                  parsedData,
                  // Flag to indicate if mapping was applied
                  episodeMappingApplied: mappedEpisodeNumber !== episodeNumber || mappedAnimeTitle !== animeTitle
                });

                if (mappedEpisodeNumber !== episodeNumber || mappedAnimeTitle !== animeTitle) {
                  console.log(`📋 RSS: Added candidate (MAPPED): "${mappedAnimeTitle}" Episode ${mappedEpisodeNumber} [${releaseGroup}] (was "${animeTitle}" Episode ${episodeNumber})`);
                } else {
                  console.log(`📋 RSS: Added candidate: "${mappedAnimeTitle}" Episode ${mappedEpisodeNumber} [${releaseGroup}]`);
                }
              } else if (alreadyProcessed) {
                console.log(`⏭️  RSS: Episode already processed: "${mappedAnimeTitle}" Episode ${mappedEpisodeNumber}`);
              } else if (existingQueuedDownload) {
                console.log(`⏭️  RSS: Episode already queued: "${mappedAnimeTitle}" Episode ${mappedEpisodeNumber}`);
              }

              // Check if the release group is globally blacklisted
              const preferredGroup = matchResult.entry.preferred_group || matchResult.entry.group;
              if (this.isGroupBlacklisted(releaseGroup, preferredGroup)) {
                console.log(`🚫 RSS: Skipping blacklisted group "${releaseGroup}" for: "${title}"`);
                if (activityLogger) {
                  activityLogger.episodeSkipped(title, `Blacklisted group: ${releaseGroup}`);
                }
                continue;
              }

            }
          } catch (itemError) {
            console.error('💥 RSS: Error processing RSS item:', itemError);
          }
        }

        console.log(`📋 RSS: Collected ${downloadCandidates.length} download candidates`);

        // Phase 2: Select latest episode for each anime
        console.log(`\n${'='.repeat(80)}`);
        console.log(`🎯 RSS: Phase 2 - Selecting latest episodes...`);
        console.log(`${'='.repeat(80)}`);

        const selectedDownloads = this.selectLatestEpisodes(downloadCandidates);
        console.log(`🎯 RSS: Selected ${selectedDownloads.length} episodes for download`);

        // Phase 3: Process selected downloads
        console.log(`\n${'='.repeat(80)}`);
        console.log(`⬇️  RSS: Phase 3 - Processing selected downloads...`);
        console.log(`${'='.repeat(80)}`);

        for (const candidate of selectedDownloads) {
          try {
            console.log(`\n🎬 RSS: Processing episode: "${candidate.title}"`);
            console.log(`✅ RSS: Found whitelist match: "${candidate.matchResult.entry.title}"`);
            console.log(`📊 RSS: Episode ${candidate.episodeNumber} [${candidate.releaseGroup}]`);

            // Log whitelist match
            if (activityLogger) {
              activityLogger.whitelistMatch(candidate.title, candidate.matchResult.entry.title, candidate.matchResult.parsedData);
            }

            // Create download using mapped episode information
            const finalTitle = this.generateFinalTitle(candidate.title, candidate.matchResult.entry, {
              ...candidate.matchResult.parsedData,
              episodeNumber: candidate.episodeNumber,  // Use mapped episode number
              animeTitle: candidate.animeTitle         // Use mapped anime title
            });

            const downloadData = {
              rssEntryId: candidate.rssId,
              torrentLink: candidate.link,
              torrentTitle: candidate.title,
              finalTitle: finalTitle,
              status: 'queued'
            };

            try {
              downloadOperations.add(downloadData);
              downloadedCount++;
              console.log(`🎉 RSS: Successfully queued download: "${finalTitle}"`);
            } catch (downloadError) {
              console.error(`Failed to add download to database:`, downloadError);
              throw downloadError;
            }

            // Track this file as processed (using MAPPED information for consistent duplicate detection)
            const processedFileData = {
              whitelist_entry_id: candidate.matchResult.entry.id,
              original_filename: candidate.title,
              final_title: finalTitle,
              episode_number: candidate.episodeNumber,        // Use mapped episode number
              anime_title: candidate.primaryNormalizedTitle,  // Use normalized mapped title
              release_group: candidate.releaseGroup,
              video_resolution: candidate.parsedData?.videoResolution || '',
              file_checksum: candidate.parsedData?.fileChecksum || '',
              torrent_link: candidate.link,
              download_status: 'queued'
            };

            try {
              processedFilesOperations.add(processedFileData);
              console.log(`✅ RSS: Episode processing completed successfully`);
            } catch (error) {
              console.error(`Failed to track processed file:`, error);
            }
          } catch (candidateError) {
            console.error('💥 RSS: Error processing selected candidate:', candidateError);
          }
        }

        const processingResult = {
          processedCount,
          downloadedCount,
          newEntries: processedCount,
          totalItems: items.length,
          candidatesFound: downloadCandidates.length,
          episodesSelected: selectedDownloads.length
        };

        // Log RSS processing result
        if (activityLogger) {
          activityLogger.rssProcessed(processingResult);
        }

        // Notify frontend about RSS processing result
        if (notificationService && downloadedCount > 0) {
          notificationService.rssProcessed(processingResult);
        }

        return processingResult;
      } catch (error) {
        console.error('Error processing RSS feed:', error);

        // Create a more user-friendly error message
        let userFriendlyMessage = 'Unknown error occurred';

        if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
          userFriendlyMessage = 'RSS server is taking too long to respond. This usually happens when the server is overloaded or your internet connection is slow.';
        } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          userFriendlyMessage = 'No internet connection or RSS server not found';
        } else if (error.code === 'ECONNREFUSED') {
          userFriendlyMessage = 'Connection refused - the RSS server may be down';
        } else if (error.code === 'ECONNRESET') {
          userFriendlyMessage = 'Connection was reset by the RSS server';
        } else if (error.code === 'EHOSTUNREACH') {
          userFriendlyMessage = 'RSS server is unreachable';
        } else if (error.code === 'EPROTO') {
          userFriendlyMessage = 'Protocol error - invalid SSL/TLS connection';
        } else if (error.response?.status === 404) {
          userFriendlyMessage = 'RSS feed not found (404) - check the URL';
        } else if (error.response?.status === 403) {
          userFriendlyMessage = 'Access forbidden (403) - you may be blocked';
        } else if (error.response?.status === 500) {
          userFriendlyMessage = 'RSS server error (500) - try again later';
        } else if (error.response?.status === 503) {
          userFriendlyMessage = 'RSS server temporarily unavailable (503)';
        } else if (error.message?.includes('Invalid RSS')) {
          userFriendlyMessage = 'Invalid RSS feed format';
        } else if (error.message) {
          userFriendlyMessage = error.message;
        }

        // Create enhanced error object
        const enhancedError = new Error(userFriendlyMessage);
        enhancedError.originalError = error;
        enhancedError.code = error.code;

        throw enhancedError;
      }
    },

    async searchFeed(query) {
      try {
        // Construct the search URL
        const baseUrl = 'https://nyaa.si/?page=rss&c=1_2&f=0';
        // Replace spaces with + and encode special characters properly for nyaa.si
        const encodedQuery = query.replace(/\s+/g, '+').replace(/[[\]]/g, (match) => {
          return match === '[' ? '%5B' : '%5D';
        });
        const searchUrl = `${baseUrl}&q=${encodedQuery}`;

        // Fetch the RSS feed
        const response = await axios.get(searchUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'MoeDownloader/1.0.0 (RSS Search)'
          }
        });

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Parse XML
        const parser = new xml2js.Parser({
          explicitArray: false,
          ignoreAttrs: false,
          mergeAttrs: true
        });

        const result = await parser.parseStringPromise(response.data);

        if (!result.rss || !result.rss.channel || !result.rss.channel.item) {
          return {
            success: true,
            query: query,
            items: [],
            total: 0
          };
        }

        // Ensure items is always an array
        const items = Array.isArray(result.rss.channel.item)
          ? result.rss.channel.item
          : [result.rss.channel.item];

        // Process each item and parse with anitomy
        const processedItems = items.map(item => {
          const title = item.title || '';
          const parsedData = parseFilename(title);

          // Handle GUID which might be an object with attributes due to XML parsing
          let guid = item.guid || '';
          if (typeof guid === 'object' && guid._) {
            guid = guid._;
          }

          return {
            title: title,
            link: item.link || '',
            guid: guid,
            pubDate: item.pubDate || '',
            seeders: parseInt(item['nyaa:seeders'] || '0'),
            leechers: parseInt(item['nyaa:leechers'] || '0'),
            downloads: parseInt(item['nyaa:downloads'] || '0'),
            size: item['nyaa:size'] || '',
            category: item['nyaa:category'] || '',
            trusted: item['nyaa:trusted'] === 'Yes',
            remake: item['nyaa:remake'] === 'Yes',
            infoHash: item['nyaa:infoHash'] || '',
            parsedData: parsedData
          };
        });

        return {
          success: true,
          query: query,
          items: processedItems,
          total: processedItems.length
        };

      } catch (error) {

        // Create user-friendly error message
        let userFriendlyMessage = 'Failed to search RSS feed';
        if (error.code === 'ENOTFOUND') {
          userFriendlyMessage = 'Unable to connect to nyaa.si. Please check your internet connection.';
        } else if (error.code === 'ETIMEDOUT') {
          userFriendlyMessage = 'Search request timed out. Please try again.';
        } else if (error.response) {
          userFriendlyMessage = `Server responded with error: ${error.response.status}`;
        }

        // Create enhanced error object
        const enhancedError = new Error(userFriendlyMessage);
        enhancedError.originalError = error;
        enhancedError.code = error.code;

        throw enhancedError;
      }
    },

    async findMatchingWhitelistEntry(title, whitelistEntries) {
      // Parse the filename to extract metadata
      const parsedData = parseFilename(title);
      if (!parsedData) {
        return { entry: null, parsedData: null };
      }

      // Apply title overrides to the parsed anime title before matching
      let transformedAnimeTitle = parsedData.animeTitle;
      let transformedEpisodeNumber = parsedData.episodeNumber ? parseInt(parsedData.episodeNumber) : null;

      if (titleOverridesManager && parsedData.animeTitle) {

        try {
          // Apply title overrides
          const overriddenTitle = titleOverridesManager.applyOverrides(parsedData.animeTitle, {
            releaseGroup: parsedData.releaseGroup
          });

          if (overriddenTitle !== parsedData.animeTitle) {
            transformedAnimeTitle = overriddenTitle;
          }

          // Apply episode mappings if we have an episode number
          if (transformedEpisodeNumber) {
            const episodeMappingResult = titleOverridesManager.applyEpisodeMappings(transformedAnimeTitle, transformedEpisodeNumber);

            if (episodeMappingResult && (
              episodeMappingResult.transformedTitle !== transformedAnimeTitle ||
              episodeMappingResult.transformedEpisode !== transformedEpisodeNumber
            )) {
              transformedAnimeTitle = episodeMappingResult.transformedTitle;
              transformedEpisodeNumber = episodeMappingResult.transformedEpisode;
            }
          }
        } catch (error) {
          console.error(`Error applying title overrides:`, error);
        }
      }

      // Apply anime relations episode mapping if available
      if (animeRelationsManager && transformedEpisodeNumber) {
        try {
          // Try to find episode mapping in anime relations database
          const relationsData = animeRelationsManager.getRelationsData();
          if (relationsData && relationsData.rules) {
            let foundMapping = null;

            // Search through all anime in relations database
            for (const [anilistId] of Object.entries(relationsData.rules)) {
              const mapping = animeRelationsManager.getEpisodeMapping(anilistId, transformedEpisodeNumber);
              if (mapping) {
                // Check if this mapping could apply to our anime title
                let originalTitle = mapping.originalAnime.title;
                let mappedTitle = mapping.mappedAnime.title;

                // If we don't have titles in relations data, try to get them from AniList
                if ((!originalTitle || !mappedTitle) && anilistService) {
                  try {
                    const promises = [];
                    if (!originalTitle) {
                      promises.push(anilistService.searchAnime(`id:${mapping.originalAnime.anilistId}`, 1, 1).catch(() => null));
                    } else {
                      promises.push(Promise.resolve(null));
                    }
                    if (!mappedTitle) {
                      promises.push(anilistService.searchAnime(`id:${mapping.mappedAnime.anilistId}`, 1, 1).catch(() => null));
                    } else {
                      promises.push(Promise.resolve(null));
                    }

                    const [originalAnime, mappedAnime] = await Promise.all(promises);

                    if (!originalTitle && originalAnime?.media?.[0]) {
                      const titles = originalAnime.media[0].title;
                      originalTitle = titles?.english || titles?.romaji || titles?.native;
                    }

                    if (!mappedTitle && mappedAnime?.media?.[0]) {
                      const titles = mappedAnime.media[0].title;
                      mappedTitle = titles?.english || titles?.romaji || titles?.native;
                    }
                  } catch (error) {
                    // Silently continue if AniList fetch fails
                  }
                }

                // Check if the original anime title matches our current title (case-insensitive)
                if (originalTitle && originalTitle.toLowerCase() === transformedAnimeTitle.toLowerCase()) {
                  foundMapping = {
                    originalTitle: transformedAnimeTitle,
                    originalEpisode: transformedEpisodeNumber,
                    mappedTitle: mappedTitle || transformedAnimeTitle,
                    mappedEpisode: mapping.mappedEpisode
                  };
                  break;
                }
              }
            }

            if (foundMapping) {
              transformedAnimeTitle = foundMapping.mappedTitle;
              transformedEpisodeNumber = foundMapping.mappedEpisode;
            }
          } else {
          }
        } catch (error) {
          console.error(`Error applying anime relations mapping:`, error);
        }
      }

      const titleLower = title.toLowerCase();
      const animeTitle = transformedAnimeTitle.toLowerCase();
      const episodeNumber = transformedEpisodeNumber;

      for (const entry of whitelistEntries) {
        // Try different matching strategies
        const matchResult = await this.tryMatchEntry(entry, title, titleLower, animeTitle, episodeNumber, parsedData);
        if (matchResult) {
          // Update parsedData with transformed values for final title generation
          const updatedParsedData = {
            ...parsedData,
            animeTitle: transformedAnimeTitle,
            episodeNumber: transformedEpisodeNumber ? transformedEpisodeNumber.toString() : parsedData.episodeNumber
          };

          // Add transformation tracking
          if (transformedAnimeTitle !== parsedData.animeTitle) {
            updatedParsedData.originalAnimeTitle = parsedData.animeTitle;
            updatedParsedData.titleOverrideApplied = true;
          }
          if (transformedEpisodeNumber && transformedEpisodeNumber.toString() !== parsedData.episodeNumber) {
            updatedParsedData.originalEpisodeNumber = parsedData.episodeNumber;
            updatedParsedData.episodeMappingApplied = true;
          }

          return { entry, parsedData: updatedParsedData };
        }
      }

      // Even if no match found, return the transformed parsedData so UI can show the transformations
      const updatedParsedData = {
        ...parsedData,
        animeTitle: transformedAnimeTitle,
        episodeNumber: transformedEpisodeNumber ? transformedEpisodeNumber.toString() : parsedData.episodeNumber
      };

      // Add transformation tracking
      if (transformedAnimeTitle !== parsedData.animeTitle) {
        updatedParsedData.originalAnimeTitle = parsedData.animeTitle;
        updatedParsedData.titleOverrideApplied = true;
      }
      if (transformedEpisodeNumber && transformedEpisodeNumber.toString() !== parsedData.episodeNumber) {
        updatedParsedData.originalEpisodeNumber = parsedData.episodeNumber;
        updatedParsedData.episodeMappingApplied = true;
      }

      return { entry: null, parsedData: updatedParsedData };
    },

    async tryMatchEntry(entry, originalTitle, titleLower, animeTitle, episodeNumber, parsedData) {
      // Strategy 1: Direct title matching (existing logic)
      if (titleLower.includes(entry.title.toLowerCase())) {
        if (this.checkKeywordsAndQuality(entry, titleLower, parsedData)) {
          return true;
        }
      }

      // Strategy 2: Anime title matching (from parsed data)
      if (animeTitle && animeTitle.includes(entry.title.toLowerCase())) {
        if (this.checkKeywordsAndQuality(entry, titleLower, parsedData)) {
          return true;
        }
      }

    // Strategy 3: Enhanced AniList title matching for auto-synced entries
    if (entry.source_type === 'anilist' && entry.auto_sync) {
      if (await this.tryAniListTitleVariants(entry, animeTitle, titleLower, parsedData)) {
        return true;
      }
    }

      // Strategy 3: AniList-based matching with relations
      if (entry.anilist_id && animeRelationsManager) {
        const matchResult = await this.tryAniListMatching(entry, animeTitle, episodeNumber, parsedData);
        if (matchResult && this.checkKeywordsAndQuality(entry, titleLower, parsedData)) {
          return true;
        }
      }

      return false;
    },

    /**
     * Try matching against AniList title variants stored in whitelist entry
     * @param {Object} entry - Whitelist entry with AniList title variants
     * @param {string} animeTitle - Parsed anime title from RSS
     * @param {string} titleLower - Full RSS title in lowercase
     * @param {Object} parsedData - Parsed RSS data
     * @returns {boolean} - True if match found
     */
    async tryAniListTitleVariants(entry, animeTitle, titleLower, parsedData) {
      if (!animeTitle) {
        return false;
      }

      const animeTitleLower = animeTitle.toLowerCase();

      // Collect all title variants to try
      const titleVariants = [];

      // Add stored title variants from whitelist entry in priority order
      // 1. Exact romaji title
      if (entry.title_romaji) titleVariants.push(entry.title_romaji.toLowerCase());

      // 2. Cleaned romaji title (without special characters)
      if (entry.title_romaji) {
        const cleanedRomaji = entry.title_romaji
          .replace(/[^\w\s]/g, ' ')  // Replace non-alphanumeric (except spaces) with spaces
          .replace(/\s+/g, ' ')      // Replace multiple spaces with single space
          .trim()
          .toLowerCase();
        if (cleanedRomaji !== entry.title_romaji.toLowerCase()) {
          titleVariants.push(cleanedRomaji);
        }
      }

      // 3. English title
      if (entry.title_english) titleVariants.push(entry.title_english.toLowerCase());

      // Add synonyms if available
      if (entry.title_synonyms) {
        try {
          const synonyms = typeof entry.title_synonyms === 'string'
            ? JSON.parse(entry.title_synonyms)
            : entry.title_synonyms;
          if (Array.isArray(synonyms)) {
            synonyms.forEach(synonym => {
              if (synonym && typeof synonym === 'string' && /^[a-zA-Z0-9\s\-:!?.,'"()&]+$/.test(synonym)) {
                titleVariants.push(synonym.toLowerCase());
              }
            });
          }
        } catch (error) {
          console.warn('Failed to parse synonyms for entry:', entry.title);
        }
      }

      // Try matching against each title variant (exact match only)
      for (const variant of titleVariants) {
        if (!variant) continue;

        // Only use exact matching to avoid mismatches
        if (animeTitleLower === variant) {
          console.log(`🎯 RSS: AniList exact title match found: "${animeTitle}" matches "${variant}" for entry "${entry.title}"`);

          // Check keywords and quality constraints
          if (this.checkKeywordsAndQuality(entry, titleLower, parsedData)) {
            return true;
          }
        }
      }

      return false;
    },



    async tryAniListMatching(entry, animeTitle, episodeNumber, parsedData) {
      try {
        // Get cached anime data
        const cachedAnime = anilistAnimeCacheOperations.getByAnilistId(entry.anilist_id);
        if (!cachedAnime) {
          return false;
        }

        // Check if parsed anime title matches any of the AniList titles/synonyms
        const titles = [
          cachedAnime.title_romaji,
          cachedAnime.title_english,
          cachedAnime.title_native,
          ...(cachedAnime.synonyms || [])
        ].filter(t => t).map(t => t.toLowerCase());

        const titleMatches = titles.some(title =>
          animeTitle.includes(title) || title.includes(animeTitle)
        );

        if (!titleMatches) {
          return false;
        }

        // If we have an episode number, check for relations mapping
        if (episodeNumber && animeRelationsManager) {
          const mapping = animeRelationsManager.getEpisodeMapping(entry.anilist_id, episodeNumber);
          if (mapping) {
            console.log(`Episode mapping found: ${entry.anilist_id} ep${episodeNumber} -> ${mapping.mappedAnime.anilistId} ep${mapping.mappedEpisode}`);
            return true;
          }
        }

        return titleMatches;
      } catch (error) {
        console.error('Error in AniList matching:', error);
        return false;
      }
    },

    checkKeywordsAndQuality(entry, titleLower, parsedData = null) {
      // Check keywords if specified
      if (entry.keywords) {
        const keywords = entry.keywords.split(',').map(k => k.trim().toLowerCase());
        const hasAllKeywords = keywords.every(keyword =>
          keyword === '' || titleLower.includes(keyword)
        );
        if (!hasAllKeywords) {
          return false;
        }
      }

      // Check exclude keywords if specified
      if (entry.exclude_keywords) {
        const excludeKeywords = entry.exclude_keywords.split(',').map(k => k.trim().toLowerCase());
        const hasExcludeKeyword = excludeKeywords.some(keyword =>
          keyword !== '' && titleLower.includes(keyword)
        );
        if (hasExcludeKeyword) {
          return false;
        }
      }

      // Check quality preference if specified
      if (entry.quality && entry.quality !== 'any') {
        if (!titleLower.includes(entry.quality.toLowerCase())) {
          return false;
        }
      }

      // Check release group preference if specified
      const preferredGroup = entry.preferred_group || entry.group; // Support both field names
      if (preferredGroup && preferredGroup !== 'any' && parsedData && parsedData.releaseGroup) {
        // If a specific group is preferred, check if it matches
        if (parsedData.releaseGroup !== preferredGroup) {
          return false;
        }
      } else if (parsedData && parsedData.releaseGroup) {
        // If preference is "any" or not specified, still check if the group is in our allowed list
        if (!this.isGroupAllowed(parsedData.releaseGroup)) {
          return false;
        }
      }

      return true;
    },

    generateFinalTitle(originalTitle, whitelistEntry, parsedData = null) {
      let episodeNumber = null;
      let episodeTitle = '';

      if (parsedData) {
        episodeNumber = parsedData.episodeNumber;
        episodeTitle = parsedData.episodeTitle;

        // Check for episode mapping if we have AniList ID and relations
        if (whitelistEntry.anilist_id && episodeNumber && animeRelationsManager) {
          const mapping = animeRelationsManager.getEpisodeMapping(whitelistEntry.anilist_id, parseInt(episodeNumber));
          if (mapping) {
            episodeNumber = mapping.mappedEpisode.toString();
          }
        }
      } else {
        // Fallback to regex extraction
        const episodeMatch = originalTitle.match(/(?:episode?\s*|ep\.?\s*|e)(\d+)/i);
        episodeNumber = episodeMatch ? episodeMatch[1] : null;
      }

      // Apply title overrides and episode mappings
      let finalTitle = whitelistEntry.title;
      let finalEpisodeNumber = episodeNumber;

      if (titleOverridesManager) {
        // First apply title overrides
        const overriddenTitle = titleOverridesManager.applyOverrides(finalTitle);
        if (overriddenTitle !== finalTitle) {
          finalTitle = overriddenTitle;
        }

        // Then apply episode mappings (can change both title and episode)
        if (finalEpisodeNumber) {
          const mappingResult = titleOverridesManager.applyEpisodeMappings(finalTitle, parseInt(finalEpisodeNumber));
          if (mappingResult.transformedTitle !== finalTitle || mappingResult.transformedEpisode !== parseInt(finalEpisodeNumber)) {
            finalTitle = mappingResult.transformedTitle;
            finalEpisodeNumber = mappingResult.transformedEpisode.toString();
          }
        }
      }

      if (finalEpisodeNumber) {
        const paddedEpisode = finalEpisodeNumber.padStart(2, '0');
        finalTitle += ` - Episode ${paddedEpisode}`;
      }

      if (episodeTitle) {
        finalTitle += ` - ${episodeTitle}`;
      }

      return finalTitle;
    },

    async testFeed(url) {
      try {
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'MoeDownloader/1.0'
          }
        });

        const parser = new xml2js.Parser();
        const testResult = await parser.parseStringPromise(response.data);

        if (!testResult.rss || !testResult.rss.channel || !testResult.rss.channel[0].item) {
          return {
            success: false,
            error: 'Invalid RSS feed format'
          };
        }

        const items = testResult.rss.channel[0].item;
        return {
          success: true,
          itemCount: items.length,
          title: testResult.rss.channel[0].title?.[0] || 'Unknown',
          description: testResult.rss.channel[0].description?.[0] || 'No description'
        };
      } catch (error) {
        // Create user-friendly error message
        let userFriendlyMessage = 'Unknown error occurred';

        if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
          userFriendlyMessage = 'Request timed out - the RSS server is taking too long to respond';
        } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          userFriendlyMessage = 'No internet connection or RSS server not found';
        } else if (error.code === 'ECONNREFUSED') {
          userFriendlyMessage = 'Connection refused - the RSS server may be down';
        } else if (error.code === 'ECONNRESET') {
          userFriendlyMessage = 'Connection was reset by the RSS server';
        } else if (error.code === 'EHOSTUNREACH') {
          userFriendlyMessage = 'RSS server is unreachable';
        } else if (error.code === 'EPROTO') {
          userFriendlyMessage = 'Protocol error - invalid SSL/TLS connection';
        } else if (error.response?.status === 404) {
          userFriendlyMessage = 'RSS feed not found (404) - check the URL';
        } else if (error.response?.status === 403) {
          userFriendlyMessage = 'Access forbidden (403) - you may be blocked';
        } else if (error.response?.status === 500) {
          userFriendlyMessage = 'RSS server error (500) - try again later';
        } else if (error.response?.status === 503) {
          userFriendlyMessage = 'RSS server temporarily unavailable (503)';
        } else if (error.message) {
          userFriendlyMessage = error.message;
        }

        return {
          success: false,
          error: userFriendlyMessage
        };
      }
    },

    async testFeed(rssUrl) {
      try {

        // Fetch RSS feed
        const response = await axios.get(rssUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'MoeDownloader/1.0'
          }
        });

        // Parse XML
        const parser = new xml2js.Parser();
        const parsedResult = await parser.parseStringPromise(response.data);

        if (!parsedResult.rss || !parsedResult.rss.channel || !parsedResult.rss.channel[0].item) {
          throw new Error('Invalid RSS feed format');
        }

        const items = parsedResult.rss.channel[0].item;
        const channelTitle = parsedResult.rss.channel[0].title?.[0] || 'Unknown';

        return {
          success: true,
          itemCount: items.length,
          channelTitle,
          message: `RSS feed is valid and contains ${items.length} items`
        };
      } catch (error) {
        console.error('Error testing RSS feed:', error);

        // Create user-friendly error message
        let userFriendlyMessage = 'Unknown error occurred';

        if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
          userFriendlyMessage = 'Request timed out - the RSS server is taking too long to respond';
        } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          userFriendlyMessage = 'No internet connection or RSS server not found';
        } else if (error.code === 'ECONNREFUSED') {
          userFriendlyMessage = 'Connection refused - the RSS server may be down';
        } else if (error.code === 'ECONNRESET') {
          userFriendlyMessage = 'Connection was reset by the RSS server';
        } else if (error.code === 'EHOSTUNREACH') {
          userFriendlyMessage = 'RSS server is unreachable';
        } else if (error.code === 'EPROTO') {
          userFriendlyMessage = 'Protocol error - invalid SSL/TLS connection';
        } else if (error.response?.status === 404) {
          userFriendlyMessage = 'RSS feed not found (404) - check the URL';
        } else if (error.response?.status === 403) {
          userFriendlyMessage = 'Access forbidden (403) - you may be blocked';
        } else if (error.response?.status === 500) {
          userFriendlyMessage = 'RSS server error (500) - try again later';
        } else if (error.response?.status === 503) {
          userFriendlyMessage = 'RSS server temporarily unavailable (503)';
        } else if (error.message?.includes('Invalid RSS')) {
          userFriendlyMessage = 'Invalid RSS feed format';
        } else if (error.message) {
          userFriendlyMessage = error.message;
        }

        throw new Error(`RSS feed test failed: ${userFriendlyMessage}`);
      }
    },

    async testRSSDownload(rssUrl, options = {}) {
      try {
        // Fetch RSS feed using the same logic as processFeed
        const response = await axios.get(rssUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'MoeDownloader/1.0'
          }
        });

        // Parse XML
        const parser = new xml2js.Parser();
        const parsedResult = await parser.parseStringPromise(response.data);

        if (!parsedResult.rss || !parsedResult.rss.channel || !parsedResult.rss.channel[0].item) {
          throw new Error('Invalid RSS feed format');
        }

        const items = parsedResult.rss.channel[0].item;
        let processedCount = 0;
        let downloadedCount = 0;
        const testResults = [];

        // Get whitelist entries (same as real implementation)
        const whitelistEntries = whitelistOperations.getAll().filter(entry => entry.enabled);

        // Process items (limit to first few for testing if specified)
        const itemsToProcess = options.maxItems ? items.slice(0, options.maxItems) : items;

        for (const item of itemsToProcess) {
          try {
            const guid = item.guid?.[0]?._ || item.guid?.[0] || item.link?.[0];
            const title = item.title?.[0] || '';
            const link = item.link?.[0] || '';
            const pubDate = item.pubDate?.[0] || '';

            if (!guid || !title || !link) {
              testResults.push({
                originalTitle: title,
                status: 'skipped',
                reason: 'Missing required fields',
                guid,
                link,
                error: 'Missing required fields (guid, title, or link)'
              });
              continue;
            }



            // Add to RSS entries for tracking (but mark as test)
            const rssResult = rssOperations.add(null, `TEST_${guid}`, `TEST: ${title}`, link, pubDate);
            const rssId = rssResult.lastInsertRowid;
            processedCount++;

            // Check against whitelist with enhanced matching (same as real implementation)
            const matchResult = await this.findMatchingWhitelistEntry(title, whitelistEntries);

            const result = {
              originalTitle: title,
              guid,
              link,
              pubDate,
              rssId,
              matchResult: matchResult,
              status: 'processed',
              downloaded: false,
              downloadId: null,
              processedFileId: null,
              error: null
            };

            if (matchResult.entry) {
              console.log(`✅ RSS: Found match for "${title}" with whitelist entry "${matchResult.entry.title}"`);
              console.log(`📊 RSS: Parsed data:`, matchResult.parsedData);

              // Check if the release group is in our allowed list (same as real implementation)
              const releaseGroup = matchResult.parsedData?.releaseGroup;
              if (!this.isGroupAllowed(releaseGroup)) {
                console.log(`🚫 TEST: Skipping torrent from disallowed group "${releaseGroup}"`);
                result.status = 'skipped';
                result.reason = `Disallowed group: ${releaseGroup}`;
                testResults.push(result);
                continue;
              }

              // Check if the release group is globally blacklisted (same as real implementation)
              const preferredGroup = matchResult.entry.preferred_group || matchResult.entry.group;
              if (this.isGroupBlacklisted(releaseGroup, preferredGroup)) {
                console.log(`🚫 TEST: Skipping blacklisted group "${releaseGroup}" for: "${title}"`);
                result.status = 'skipped';
                result.reason = `Blacklisted group: ${releaseGroup}`;
                testResults.push(result);
                continue;
              }

              // IMPORTANT: Apply anime relations and episode mapping BEFORE duplicate checks (same as real implementation)
              let episodeNumber = matchResult.parsedData?.episodeNumber || '';
              let animeTitle = matchResult.parsedData?.animeTitle || matchResult.entry.title;
              let mappedEpisodeNumber = episodeNumber;
              let mappedAnimeTitle = animeTitle;

              // Apply anime relations episode mapping if available
              if (animeRelationsManager && episodeNumber && matchResult.entry.anilist_id) {
                try {
                  const mapping = animeRelationsManager.getEpisodeMapping(matchResult.entry.anilist_id, parseInt(episodeNumber));
                  if (mapping) {
                    mappedEpisodeNumber = mapping.mappedEpisode.toString();
                    // Try to get the mapped anime title
                    if (mapping.mappedAnime.title) {
                      mappedAnimeTitle = mapping.mappedAnime.title;
                    }
                    console.log(`🔄 TEST: Applied episode mapping: "${animeTitle}" Episode ${episodeNumber} → "${mappedAnimeTitle}" Episode ${mappedEpisodeNumber}`);
                  }
                } catch (error) {
                  console.error('❌ TEST: Error applying anime relations mapping:', error);
                }
              }

              // Apply title overrides and episode mappings
              if (titleOverridesManager) {
                try {
                  // Apply title overrides
                  const overriddenTitle = titleOverridesManager.applyOverrides(mappedAnimeTitle);
                  if (overriddenTitle !== mappedAnimeTitle) {
                    mappedAnimeTitle = overriddenTitle;
                    console.log(`🔄 TEST: Applied title override: "${animeTitle}" → "${mappedAnimeTitle}"`);
                  }

                  // Apply episode mappings
                  if (mappedEpisodeNumber) {
                    const episodeMappingResult = titleOverridesManager.applyEpisodeMappings(mappedAnimeTitle, parseInt(mappedEpisodeNumber));
                    if (episodeMappingResult && (
                      episodeMappingResult.transformedTitle !== mappedAnimeTitle ||
                      episodeMappingResult.transformedEpisode !== parseInt(mappedEpisodeNumber)
                    )) {
                      mappedAnimeTitle = episodeMappingResult.transformedTitle;
                      mappedEpisodeNumber = episodeMappingResult.transformedEpisode.toString();
                      console.log(`🔄 TEST: Applied episode mapping: Episode ${episodeNumber} → Episode ${mappedEpisodeNumber}, Title: "${animeTitle}" → "${mappedAnimeTitle}"`);
                    }
                  }
                } catch (error) {
                  console.error('❌ TEST: Error applying title overrides:', error);
                }
              }

              // Get all possible title variations using the MAPPED title (same as real implementation)
              const titleVariations = this.getAnimeTitleVariations(mappedAnimeTitle, matchResult.entry);
              console.log(`🔍 TEST: Checking processed files for title variations:`, titleVariations);

              const alreadyProcessed = this.checkEpisodeExistsAnyVariation(mappedEpisodeNumber, titleVariations);

              if (alreadyProcessed && !options.ignoreProcessedFiles) {
                console.log(`⏭️  RSS: Episode already processed in database, skipping: "${title}"`);
                result.status = 'already_processed';
                result.reason = 'Episode already processed in database';
              } else {
                // Check if this MAPPED episode is already queued for download (same logic as real implementation)
                const existingQueuedDownload = this.checkEpisodeQueuedAnyVariation(mappedEpisodeNumber, titleVariations);

                if (existingQueuedDownload && !options.ignoreProcessedFiles) {
                  console.log(`⏭️  TEST: Episode already queued for download, skipping: "${title}" (mapped to "${mappedAnimeTitle}" Episode ${mappedEpisodeNumber})`);
                  result.status = 'already_queued';
                  result.reason = 'Episode already queued for download';
                } else {
                  if (mappedEpisodeNumber !== episodeNumber || mappedAnimeTitle !== animeTitle) {
                    console.log(`✅ TEST: Episode not yet processed, proceeding with download: "${title}" (mapped to "${mappedAnimeTitle}" Episode ${mappedEpisodeNumber})`);
                  } else {
                    console.log(`✅ TEST: Episode not yet processed, proceeding with download: "${title}"`);
                  }

                  // Create download using mapped episode information (same logic as real implementation)
                  console.log(`🏗️  TEST: Generating final title for download...`);
                  const finalTitle = this.generateFinalTitle(title, matchResult.entry, {
                    ...matchResult.parsedData,
                    episodeNumber: mappedEpisodeNumber,  // Use mapped episode number
                    animeTitle: mappedAnimeTitle         // Use mapped anime title
                  });
                  console.log(`🏷️  TEST: Generated final title: "${finalTitle}"`);

                  const downloadData = {
                    rssEntryId: rssId,
                    torrentLink: link,
                    torrentTitle: title,
                    finalTitle: finalTitle,
                    status: 'queued'
                  };

                console.log(`💾 RSS: Adding download to database:`, {
                  finalTitle,
                  torrentLink: link,
                  status: 'queued'
                });

                try {
                  const downloadResult = downloadOperations.add(downloadData);
                  downloadedCount++;
                  result.downloaded = true;
                  result.downloadId = downloadResult.lastInsertRowid;
                  result.finalTitle = finalTitle;
                  console.log(`🎉 RSS: Successfully added download: "${finalTitle}"`, {
                    downloadId: downloadResult.lastInsertRowid,
                    changes: downloadResult.changes
                  });
                } catch (downloadError) {
                  console.error(`💥 RSS: Failed to add download to database:`, downloadError);
                  result.error = `Failed to add download: ${downloadError.message}`;
                  result.status = 'download_failed';
                }

                // Track this file as processed (same logic as real implementation)
                if (result.downloaded) {
                  const processedFileData = {
                    whitelist_entry_id: matchResult.entry.id,
                    original_filename: title,
                    final_title: finalTitle,
                    episode_number: episodeNumber,
                    anime_title: animeTitle,
                    release_group: matchResult.parsedData?.releaseGroup || '',
                    video_resolution: matchResult.parsedData?.videoResolution || '',
                    file_checksum: matchResult.parsedData?.fileChecksum || '',
                    torrent_link: link,
                    download_status: 'queued'
                  };

                  try {
                    const processedResult = processedFilesOperations.add(processedFileData);
                    result.processedFileId = processedResult.lastInsertRowid;
                    console.log(`📝 RSS: Tracked processed file: "${finalTitle}"`, {
                      insertId: processedResult.lastInsertRowid,
                      changes: processedResult.changes
                    });
                  } catch (error) {
                    console.error(`❌ RSS: Failed to track processed file:`, error);
                    result.error = result.error ? `${result.error}; Failed to track processed file: ${error.message}` : `Failed to track processed file: ${error.message}`;
                  }
                }
                }
              }
            } else {
              console.log(`❌ RSS: No whitelist match found for: "${title}"`);
              result.status = 'no_match';
              result.reason = 'No whitelist match found';
            }

            testResults.push(result);
          } catch (itemError) {
            console.error('💥 RSS: Error processing RSS item:', itemError);
            testResults.push({
              originalTitle: item.title?.[0] || 'Unknown',
              status: 'error',
              error: itemError.message,
              guid: item.guid?.[0]?._ || item.guid?.[0] || item.link?.[0],
              link: item.link?.[0] || ''
            });
          }
        }

        const processingResult = {
          success: true,
          rssUrl: rssUrl,
          processedCount,
          downloadedCount,
          newEntries: processedCount,
          totalItems: items.length,
          processedItems: itemsToProcess.length,
          results: testResults,
          summary: {
            totalItems: items.length,
            processedItems: itemsToProcess.length,
            processedCount,
            downloadedCount,
            alreadyProcessed: testResults.filter(r => r.status === 'already_processed').length,
            noMatches: testResults.filter(r => r.status === 'no_match').length,
            errors: testResults.filter(r => r.status === 'error').length,
            skipped: testResults.filter(r => r.status === 'skipped').length
          }
        };

        console.log('🧪 TEST: RSS download test completed:', processingResult.summary);

        // Notify frontend about RSS processing result (if enabled)
        if (notificationService && processedCount > 0 && options.sendNotifications !== false) {
          notificationService.rssProcessed({
            ...processingResult,
            testMode: true
          });
        }

        return processingResult;
      } catch (error) {
        console.error('🧪 TEST: RSS download test failed:', error);

        // Create user-friendly error message
        let userFriendlyMessage = 'Unknown error occurred';

        if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
          userFriendlyMessage = 'Request timed out - the RSS server is taking too long to respond';
        } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          userFriendlyMessage = 'No internet connection or RSS server not found';
        } else if (error.code === 'ECONNREFUSED') {
          userFriendlyMessage = 'Connection refused - the RSS server may be down';
        } else if (error.code === 'ECONNRESET') {
          userFriendlyMessage = 'Connection was reset by the RSS server';
        } else if (error.code === 'EHOSTUNREACH') {
          userFriendlyMessage = 'RSS server is unreachable';
        } else if (error.code === 'EPROTO') {
          userFriendlyMessage = 'Protocol error - invalid SSL/TLS connection';
        } else if (error.response?.status === 404) {
          userFriendlyMessage = 'RSS feed not found (404) - check the URL';
        } else if (error.response?.status === 403) {
          userFriendlyMessage = 'Access forbidden (403) - you may be blocked';
        } else if (error.response?.status === 500) {
          userFriendlyMessage = 'RSS server error (500) - try again later';
        } else if (error.response?.status === 503) {
          userFriendlyMessage = 'RSS server temporarily unavailable (503)';
        } else if (error.message?.includes('Invalid RSS')) {
          userFriendlyMessage = 'Invalid RSS feed format';
        } else if (error.message) {
          userFriendlyMessage = error.message;
        }

        return {
          success: false,
          error: userFriendlyMessage,
          rssUrl: rssUrl
        };
      }
    },

    async reloadUserOverrides() {
      try {
        if (titleOverridesManager && titleOverridesManager.loadUserOverrides) {
          await titleOverridesManager.loadUserOverrides();
          console.log('🔄 RSS Processor: Reloaded user title overrides');
          return { success: true };
        } else {
          console.warn('⚠️  RSS Processor: Title overrides manager not available');
          return { success: false, error: 'Title overrides manager not available' };
        }
      } catch (error) {
        console.error('❌ RSS Processor: Failed to reload user overrides:', error);
        return { success: false, error: error.message };
      }
    },

    async testRSSContinuousNumeration(rssUrl) {
      try {
        console.log('🧪 TEST: Starting RSS continuous numeration test for:', rssUrl);

        // Fetch RSS feed
        const response = await axios.get(rssUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'MoeDownloader/1.0'
          }
        });

        // Parse XML
        const parser = new xml2js.Parser();
        const parsedResult = await parser.parseStringPromise(response.data);

        if (!parsedResult.rss || !parsedResult.rss.channel || !parsedResult.rss.channel[0].item) {
          throw new Error('Invalid RSS feed format');
        }

        const items = parsedResult.rss.channel[0].item;
        console.log(`🧪 TEST: Found ${items.length} items in RSS feed`);

        const testResults = [];

        // Process each item
        for (const item of items) {
          const title = item.title?.[0] || '';
          console.log(`🧪 TEST: Processing: "${title}"`);

          // Parse filename using anitomy
          const parsedData = parseFilename(title);

          const result = {
            originalTitle: title,
            parsedData: parsedData,
            animeRelationsResult: null,
            titleOverridesResult: null,
            error: null
          };

          if (parsedData) {
            console.log(`🧪 TEST: Parsed data:`, {
              animeTitle: parsedData.animeTitle,
              episodeNumber: parsedData.episodeNumber,
              releaseGroup: parsedData.releaseGroup,
              videoResolution: parsedData.videoResolution
            });

            // Test title overrides system
            if (titleOverridesManager && parsedData.animeTitle) {
              try {
                console.log(`🧪 TEST: Testing title overrides for "${parsedData.animeTitle}"`);

                // Store original parsed data before applying overrides
                const originalParsedData = { ...parsedData };

                // Test title overrides
                const overriddenTitle = titleOverridesManager.applyOverrides(parsedData.animeTitle, {
                  releaseGroup: parsedData.releaseGroup
                });

                // Test episode mappings
                let episodeMappingResult = null;
                if (parsedData.episodeNumber) {
                  const episodeNum = parseInt(parsedData.episodeNumber);
                  episodeMappingResult = titleOverridesManager.applyEpisodeMappings(overriddenTitle, episodeNum);
                }

                // Apply the overrides to the parsed data that will be displayed
                if (overriddenTitle !== parsedData.animeTitle) {
                  parsedData.animeTitle = overriddenTitle;
                  parsedData.titleOverrideApplied = true;
                  parsedData.originalAnimeTitle = originalParsedData.animeTitle;
                }

                if (episodeMappingResult && (
                  episodeMappingResult.transformedTitle !== overriddenTitle ||
                  episodeMappingResult.transformedEpisode !== parseInt(parsedData.episodeNumber || '0')
                )) {
                  parsedData.animeTitle = episodeMappingResult.transformedTitle;
                  parsedData.episodeNumber = episodeMappingResult.transformedEpisode.toString();
                  parsedData.episodeMappingApplied = true;
                  if (!parsedData.originalAnimeTitle) {
                    parsedData.originalAnimeTitle = originalParsedData.animeTitle;
                  }
                  parsedData.originalEpisodeNumber = originalParsedData.episodeNumber;
                }

                result.titleOverridesResult = {
                  originalTitle: originalParsedData.animeTitle,
                  overriddenTitle: overriddenTitle,
                  titleChanged: overriddenTitle !== originalParsedData.animeTitle,
                  episodeMapping: episodeMappingResult,
                  episodeChanged: episodeMappingResult && (
                    episodeMappingResult.transformedTitle !== overriddenTitle ||
                    episodeMappingResult.transformedEpisode !== parseInt(originalParsedData.episodeNumber || '0')
                  )
                };

                console.log(`🧪 TEST: Title overrides result:`, result.titleOverridesResult);
                console.log(`🧪 TEST: Updated parsed data:`, parsedData);
              } catch (overrideError) {
                console.log(`🧪 TEST: Title overrides test failed:`, overrideError.message);
                result.titleOverridesResult = {
                  error: overrideError.message
                };
              }
            }

            // Test anime relations if we have episode number
            if (parsedData.episodeNumber && animeRelationsManager) {
              try {
                const episodeNum = parseInt(parsedData.episodeNumber);
                console.log(`🧪 TEST: Testing episode ${episodeNum} for "${parsedData.animeTitle}" continuous numeration`);

                // First, try to find if this specific anime title needs episode mapping
                let specificMapping = null;
                let searchedAnilistId = null;

                // Try to search AniList for this anime title to get its AniList ID
                if (anilistService && parsedData.animeTitle) {
                  try {
                    const searchResult = await anilistService.searchAnime(parsedData.animeTitle, 1, 5);
                    if (searchResult && searchResult.media && searchResult.media.length > 0) {
                      // Check each search result to see if any have episode mappings
                      for (const anime of searchResult.media) {
                        const anilistId = anime.id.toString();
                        const mapping = animeRelationsManager.getEpisodeMapping(anilistId, episodeNum);
                        if (mapping) {
                          specificMapping = mapping;
                          searchedAnilistId = anilistId;
                          console.log(`🧪 TEST: Found specific mapping for "${parsedData.animeTitle}" (ID: ${anilistId})`);
                          break;
                        }
                      }
                    }
                  } catch (searchError) {
                    console.log(`🧪 TEST: Could not search AniList for "${parsedData.animeTitle}":`, searchError.message);
                  }
                }

                // Get all relations data to show general statistics
                const relationsData = animeRelationsManager.getRelationsData();
                const allMappings = [];
                const testedAnime = [];

                if (relationsData && relationsData.rules) {
                  // Check all anime in the relations data to see if any have mappings for this episode
                  for (const [anilistId] of Object.entries(relationsData.rules)) {
                    const mapping = animeRelationsManager.getEpisodeMapping(anilistId, episodeNum);
                    if (mapping) {
                      console.log(`🧪 TEST: Found episode mapping for AniList ID ${anilistId} ep${episodeNum}`);

                      // Get anime titles from relations data (preferred) or fallback to AniList
                      let originalTitle = mapping.originalAnime.title;
                      let mappedTitle = mapping.mappedAnime.title;

                      // If we don't have titles in relations data, try to get them from AniList
                      if ((!originalTitle || !mappedTitle) && anilistService) {
                        try {
                          const promises = [];
                          if (!originalTitle) {
                            promises.push(anilistService.searchAnime(`id:${mapping.originalAnime.anilistId}`, 1, 1).catch(() => null));
                          } else {
                            promises.push(Promise.resolve(null));
                          }
                          if (!mappedTitle) {
                            promises.push(anilistService.searchAnime(`id:${mapping.mappedAnime.anilistId}`, 1, 1).catch(() => null));
                          } else {
                            promises.push(Promise.resolve(null));
                          }

                          const [originalAnime, mappedAnime] = await Promise.all(promises);

                          if (!originalTitle && originalAnime?.media?.[0]) {
                            const titles = originalAnime.media[0].title;
                            originalTitle = titles?.english || titles?.romaji || titles?.native;
                          }

                          if (!mappedTitle && mappedAnime?.media?.[0]) {
                            const titles = mappedAnime.media[0].title;
                            mappedTitle = titles?.english || titles?.romaji || titles?.native;
                          }
                        } catch (error) {
                          console.log(`🧪 TEST: Could not fetch anime titles from AniList:`, error.message);
                        }
                      }

                      allMappings.push({
                        original: {
                          anilistId: mapping.originalAnime.anilistId,
                          episode: mapping.originalEpisode,
                          title: originalTitle
                        },
                        mapped: {
                          anilistId: mapping.mappedAnime.anilistId,
                          episode: mapping.mappedEpisode,
                          title: mappedTitle
                        }
                      });
                    }
                    testedAnime.push(anilistId);
                  }
                }

                console.log(`🧪 TEST: Tested ${testedAnime.length} anime from relations data, found ${allMappings.length} mappings`);

                // If we found a specific mapping for this anime, modify the parsed data to show the mapped information
                if (specificMapping) {
                  console.log(`🧪 TEST: Applying episode mapping: ${specificMapping.originalEpisode} -> ${specificMapping.mappedEpisode}`);

                  // Get the mapped anime title from the relations data (preferred) or fallback to AniList
                  let mappedAnimeTitle = specificMapping.mappedAnime.title || parsedData.animeTitle;

                  // If we don't have the title in relations data, try to get it from AniList
                  if (!specificMapping.mappedAnime.title && anilistService) {
                    try {
                      const mappedAnime = await anilistService.searchAnime(`id:${specificMapping.mappedAnime.anilistId}`, 1, 1);
                      if (mappedAnime?.media?.[0]) {
                        const titles = mappedAnime.media[0].title;
                        mappedAnimeTitle = titles?.english || titles?.romaji || titles?.native || parsedData.animeTitle;
                        console.log(`🧪 TEST: Fetched mapped anime title from AniList: "${parsedData.animeTitle}" -> "${mappedAnimeTitle}"`);
                      }
                    } catch (error) {
                      console.log(`🧪 TEST: Could not fetch mapped anime title from AniList:`, error.message);
                    }
                  } else if (specificMapping.mappedAnime.title) {
                    console.log(`🧪 TEST: Using mapped anime title from relations data: "${parsedData.animeTitle}" -> "${mappedAnimeTitle}"`);
                  }

                  // Create a copy of parsed data with mapped episode and title information
                  result.parsedData = {
                    ...parsedData,
                    animeTitle: mappedAnimeTitle,
                    episodeNumber: specificMapping.mappedEpisode.toString(),
                    originalAnimeTitle: parsedData.animeTitle,
                    originalEpisodeNumber: specificMapping.originalEpisode.toString(),
                    mappedFromAnilistId: specificMapping.originalAnime.anilistId,
                    mappedToAnilistId: specificMapping.mappedAnime.anilistId,
                    episodeMappingApplied: true
                  };
                }

                result.animeRelationsResult = {
                  inputEpisode: episodeNum,
                  parsedTitle: parsedData.animeTitle,
                  searchedAnilistId: searchedAnilistId,
                  specificMappingFound: !!specificMapping,
                  testedAnimeCount: testedAnime.length,
                  totalRelationsCount: relationsData ? Object.keys(relationsData.rules || {}).length : 0,
                  mappings: allMappings,
                  specificMapping: specificMapping ? {
                    original: {
                      anilistId: specificMapping.originalAnime.anilistId,
                      episode: specificMapping.originalEpisode
                    },
                    mapped: {
                      anilistId: specificMapping.mappedAnime.anilistId,
                      episode: specificMapping.mappedEpisode
                    }
                  } : null,
                  explanation: specificMapping
                    ? `Episode mapping applied: Episode ${specificMapping.originalEpisode} mapped to Episode ${specificMapping.mappedEpisode}`
                    : allMappings.length > 0
                      ? `Found ${allMappings.length} other anime that have episode ${episodeNum} mapped, but none match "${parsedData.animeTitle}"`
                      : `No anime in the relations database have episode ${episodeNum} mapped to different seasons`
                };

              } catch (error) {
                result.animeRelationsResult = {
                  error: error.message,
                  tested: false
                };
              }
            }
          } else {
            result.error = 'Failed to parse filename with anitomy';
          }

          testResults.push(result);
        }

        return {
          success: true,
          rssUrl: rssUrl,
          itemCount: items.length,
          results: testResults,
          summary: {
            totalItems: items.length,
            successfullyParsed: testResults.filter(r => r.parsedData !== null).length,
            withEpisodeNumbers: testResults.filter(r => r.parsedData?.episodeNumber).length,
            errors: testResults.filter(r => r.error !== null).length
          }
        };

      } catch (error) {
        console.error('🧪 TEST: RSS continuous numeration test failed:', error);

        // Create user-friendly error message
        let userFriendlyMessage = 'Unknown error occurred';

        if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
          userFriendlyMessage = 'Request timed out - the RSS server is taking too long to respond';
        } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          userFriendlyMessage = 'No internet connection or RSS server not found';
        } else if (error.code === 'ECONNREFUSED') {
          userFriendlyMessage = 'Connection refused - the RSS server may be down';
        } else if (error.code === 'ECONNRESET') {
          userFriendlyMessage = 'Connection was reset by the RSS server';
        } else if (error.code === 'EHOSTUNREACH') {
          userFriendlyMessage = 'RSS server is unreachable';
        } else if (error.code === 'EPROTO') {
          userFriendlyMessage = 'Protocol error - invalid SSL/TLS connection';
        } else if (error.response?.status === 404) {
          userFriendlyMessage = 'RSS feed not found (404) - check the URL';
        } else if (error.response?.status === 403) {
          userFriendlyMessage = 'Access forbidden (403) - you may be blocked';
        } else if (error.response?.status === 500) {
          userFriendlyMessage = 'RSS server error (500) - try again later';
        } else if (error.response?.status === 503) {
          userFriendlyMessage = 'RSS server temporarily unavailable (503)';
        } else if (error.message?.includes('Invalid RSS')) {
          userFriendlyMessage = 'Invalid RSS feed format';
        } else if (error.message) {
          userFriendlyMessage = error.message;
        }

        return {
          success: false,
          error: userFriendlyMessage,
          rssUrl: rssUrl
        };
      }
    }
  };

  return processor;
}

module.exports = { createRSSProcessor };
