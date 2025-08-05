const axios = require('axios');
const xml2js = require('xml2js');
const {
  whitelistOperations,
  downloadOperations,
  rssOperations,
  configOperations,
  anilistAnimeCacheOperations,
  processedFilesOperations
} = require("../lib/database");
const { parseFilename } = require('../lib/filename-parser');
const { createAnimeRelationsManager } = require('./anime-relations');
const { createTitleOverridesManager } = require('./title-overrides');

function createRSSProcessor(notificationService = null, anilistService = null) {
  let animeRelationsManager = null;
  let titleOverridesManager = null;

  const processor = {
    async initialize() {
      try {
        animeRelationsManager = createAnimeRelationsManager();
        await animeRelationsManager.initialize();

        titleOverridesManager = createTitleOverridesManager();
        await titleOverridesManager.initialize();

        // Debug: Show what user overrides are loaded at startup
        const userOverridesData = titleOverridesManager.getUserOverridesData();
        console.log('🔍 RSS PROCESSOR STARTUP: User title overrides status:');
        if (userOverridesData && userOverridesData.overrides) {
          if (userOverridesData.overrides.exact_match) {
            const exactMatches = Object.entries(userOverridesData.overrides.exact_match);
            console.log(`  📝 Exact matches loaded: ${exactMatches.length}`);
            exactMatches.forEach(([original, override]) => {
              console.log(`    "${original}" -> "${override}"`);
            });
          } else {
            console.log('  ⚠️  No exact matches found in user overrides');
          }

          if (userOverridesData.overrides.episode_mappings) {
            console.log(`  📺 Episode mappings loaded: ${userOverridesData.overrides.episode_mappings.length}`);
          } else {
            console.log('  ⚠️  No episode mappings found in user overrides');
          }
        } else {
          console.log('  ❌ No user overrides data loaded');
        }

        console.log('RSS processor initialized with anime relations and title overrides support');
      } catch (error) {
        console.error('Failed to initialize RSS processor:', error);
      }
    },
    async processFeed(rssUrl) {
      try {
        console.log('🔄 RSS: Fetching RSS feed from:', rssUrl);

        // Fetch RSS feed
        const response = await axios.get(rssUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'MoeDownloader/1.0'
          }
        });

        console.log('📡 RSS: Response received, size:', response.data.length, 'bytes');

        // Parse XML
        const parser = new xml2js.Parser();
        const parsedResult = await parser.parseStringPromise(response.data);

        if (!parsedResult.rss || !parsedResult.rss.channel || !parsedResult.rss.channel[0].item) {
          throw new Error('Invalid RSS feed format');
        }

        const items = parsedResult.rss.channel[0].item;
        console.log(`📋 RSS: Found ${items.length} RSS items to process`);

        let processedCount = 0;
        let downloadedCount = 0;

        // Get whitelist entries
        const whitelistEntries = whitelistOperations.getAll().filter(entry => entry.enabled);
        console.log(`📝 RSS: Found ${whitelistEntries.length} enabled whitelist entries`);

        for (const item of items) {
          try {
            const guid = item.guid?.[0]?._ || item.guid?.[0] || item.link?.[0];
            const title = item.title?.[0] || '';
            const link = item.link?.[0] || '';
            const pubDate = item.pubDate?.[0] || '';

            console.log(`🔍 RSS: Processing item: "${title}"`);

            if (!guid || !title || !link) {
              console.warn('⚠️  RSS: Skipping item with missing required fields:', { guid, title, link });
              continue;
            }

            // Add to RSS entries for tracking (but don't use for duplicate detection)
            console.log(`📝 RSS: Adding RSS entry to database...`);
            const rssResult = rssOperations.add(null, guid, title, link, pubDate);
            const rssId = rssResult.lastInsertRowid;
            console.log(`✅ RSS: Added RSS entry with ID: ${rssId}`);
            processedCount++;
            console.log(`📥 RSS: Added to RSS entries: "${title}"`);

            // Check against whitelist with enhanced matching
            console.log(`🎯 RSS: Checking whitelist matches for: "${title}"`);
            const matchResult = await this.findMatchingWhitelistEntry(title, whitelistEntries);
            if (matchResult.entry) {
              console.log(`✅ RSS: Found match for "${title}" with whitelist entry "${matchResult.entry.title}"`);
              console.log(`📊 RSS: Parsed data:`, matchResult.parsedData);

              // Check if this episode was already processed
              const episodeNumber = matchResult.parsedData?.episodeNumber || '';
              const animeTitle = matchResult.parsedData?.animeTitle || matchResult.entry.title;

              console.log(`🔍 RSS: Checking processed files for:`, {
                whitelistEntryId: matchResult.entry.id,
                episodeNumber,
                animeTitle,
                originalTitle: title
              });

              const alreadyProcessed = processedFilesOperations.exists(
                matchResult.entry.id,
                episodeNumber,
                animeTitle
              );

              if (alreadyProcessed) {
                console.log(`⏭️  RSS: Episode already processed in database, skipping: "${title}"`);
                continue;
              } else {
                console.log(`✅ RSS: Episode not yet processed, proceeding with download: "${title}"`);
              }

              // Create download
              console.log(`🏗️  RSS: Generating final title for download...`);
              const finalTitle = this.generateFinalTitle(title, matchResult.entry, matchResult.parsedData);
              console.log(`🏷️  RSS: Generated final title: "${finalTitle}"`);

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
                console.log(`🎉 RSS: Successfully added download: "${finalTitle}"`, {
                  downloadId: downloadResult.lastInsertRowid,
                  changes: downloadResult.changes
                });
              } catch (downloadError) {
                console.error(`💥 RSS: Failed to add download to database:`, downloadError);
                console.error(`💥 RSS: Download data that failed:`, downloadData);
                throw downloadError;
              }

              // Track this file as processed
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
                const result = processedFilesOperations.add(processedFileData);
                console.log(`📝 RSS: Tracked processed file: "${finalTitle}"`, {
                  insertId: result.lastInsertRowid,
                  changes: result.changes
                });
              } catch (error) {
                console.error(`❌ RSS: Failed to track processed file:`, error);
                console.error(`❌ RSS: Processed file data:`, processedFileData);
              }
            } else {
              console.log(`❌ RSS: No whitelist match found for: "${title}"`);
            }
          } catch (itemError) {
            console.error('💥 RSS: Error processing RSS item:', itemError);
          }
        }

        const processingResult = {
          processedCount,
          downloadedCount,
          newEntries: processedCount,
          totalItems: items.length
        };

        console.log('RSS processing completed:', processingResult);

        // Notify frontend about RSS processing result
        if (notificationService && processedCount > 0) {
          notificationService.rssProcessed(processingResult);
        }

        return processingResult;
      } catch (error) {
        console.error('Error processing RSS feed:', error);
        throw error;
      }
    },

    async findMatchingWhitelistEntry(title, whitelistEntries) {
      console.log(`🔍 MATCH: Starting match process for: "${title}"`);

      // Parse the filename to extract metadata
      const parsedData = parseFilename(title);
      if (!parsedData) {
        console.log(`❌ MATCH: Failed to parse filename: "${title}"`);
        return { entry: null, parsedData: null };
      }

      console.log(`📊 MATCH: Parsed filename data:`, {
        animeTitle: parsedData.animeTitle,
        episodeNumber: parsedData.episodeNumber,
        releaseGroup: parsedData.releaseGroup,
        videoResolution: parsedData.videoResolution,
        fileExtension: parsedData.fileExtension
      });

      // Apply title overrides to the parsed anime title before matching
      let transformedAnimeTitle = parsedData.animeTitle;
      let transformedEpisodeNumber = parsedData.episodeNumber ? parseInt(parsedData.episodeNumber) : null;

      console.log(`🔄 MATCH: Title overrides manager available: ${!!titleOverridesManager}`);

      if (titleOverridesManager && parsedData.animeTitle) {
        console.log(`🔄 MATCH: Applying title overrides to: "${parsedData.animeTitle}"`);

        // Debug: Show what user overrides are loaded
        const userOverridesData = titleOverridesManager.getUserOverridesData();
        if (userOverridesData && userOverridesData.overrides) {
          if (userOverridesData.overrides.exact_match) {
            const exactMatches = Object.keys(userOverridesData.overrides.exact_match);
            console.log(`🔍 MATCH: User exact matches available: [${exactMatches.join(', ')}]`);
          } else {
            console.log(`⚠️  MATCH: No user exact matches loaded`);
          }

          if (userOverridesData.overrides.episode_mappings) {
            console.log(`🔍 MATCH: User episode mappings available: ${userOverridesData.overrides.episode_mappings.length}`);
            userOverridesData.overrides.episode_mappings.forEach((mapping, index) => {
              console.log(`  ${index + 1}. "${mapping.source_title}" ep${mapping.source_episode_start}-${mapping.source_episode_end} -> "${mapping.dest_title}" ep${mapping.dest_episode_start}-${mapping.dest_episode_end}`);
            });
          } else {
            console.log(`⚠️  MATCH: No user episode mappings loaded`);
          }
        } else {
          console.log(`⚠️  MATCH: No user overrides data loaded`);
        }

        try {
          // Apply title overrides
          const overriddenTitle = titleOverridesManager.applyOverrides(parsedData.animeTitle, {
            releaseGroup: parsedData.releaseGroup
          });

          console.log(`🔄 MATCH: Title override result: "${parsedData.animeTitle}" -> "${overriddenTitle}"`);

          if (overriddenTitle !== parsedData.animeTitle) {
            console.log(`✅ MATCH: Title override applied: "${parsedData.animeTitle}" -> "${overriddenTitle}"`);
            transformedAnimeTitle = overriddenTitle;
          } else {
            console.log(`ℹ️  MATCH: No title override needed for: "${parsedData.animeTitle}"`);
          }

          // Apply episode mappings if we have an episode number
          if (transformedEpisodeNumber) {
            console.log(`🔄 MATCH: Applying episode mappings to: "${transformedAnimeTitle}" ep${transformedEpisodeNumber}`);

            // Debug: Show what episode mappings are being checked
            if (userOverridesData && userOverridesData.overrides && userOverridesData.overrides.episode_mappings) {
              console.log(`🔍 MATCH: Checking ${userOverridesData.overrides.episode_mappings.length} user episode mappings:`);
              userOverridesData.overrides.episode_mappings.forEach((mapping, index) => {
                const matches = mapping.source_title === transformedAnimeTitle &&
                               transformedEpisodeNumber >= mapping.source_episode_start &&
                               transformedEpisodeNumber <= mapping.source_episode_end;
                console.log(`  ${index + 1}. "${mapping.source_title}" ep${mapping.source_episode_start}-${mapping.source_episode_end} -> "${mapping.dest_title}" ep${mapping.dest_episode_start}-${mapping.dest_episode_end} ${matches ? '✅ MATCH' : '❌'}`);
                if (!matches) {
                  if (mapping.source_title !== transformedAnimeTitle) {
                    console.log(`    ❌ Title mismatch: "${mapping.source_title}" !== "${transformedAnimeTitle}"`);
                  }
                  if (!(transformedEpisodeNumber >= mapping.source_episode_start && transformedEpisodeNumber <= mapping.source_episode_end)) {
                    console.log(`    ❌ Episode range mismatch: ${transformedEpisodeNumber} not in range ${mapping.source_episode_start}-${mapping.source_episode_end}`);
                  }
                }
              });
            }

            const episodeMappingResult = titleOverridesManager.applyEpisodeMappings(transformedAnimeTitle, transformedEpisodeNumber);
            console.log(`🔄 MATCH: Episode mapping result:`, episodeMappingResult);

            if (episodeMappingResult && (
              episodeMappingResult.transformedTitle !== transformedAnimeTitle ||
              episodeMappingResult.transformedEpisode !== transformedEpisodeNumber
            )) {
              console.log(`✅ MATCH: Episode mapping applied: "${transformedAnimeTitle}" ep${transformedEpisodeNumber} -> "${episodeMappingResult.transformedTitle}" ep${episodeMappingResult.transformedEpisode}`);
              transformedAnimeTitle = episodeMappingResult.transformedTitle;
              transformedEpisodeNumber = episodeMappingResult.transformedEpisode;
            } else {
              console.log(`ℹ️  MATCH: No episode mapping needed for: "${transformedAnimeTitle}" ep${transformedEpisodeNumber}`);
            }
          }
        } catch (error) {
          console.error(`❌ MATCH: Error applying title overrides:`, error);
        }
      } else {
        console.log(`⚠️  MATCH: Title overrides manager not available or no anime title to process`);
      }

      // Apply anime relations episode mapping if available
      if (animeRelationsManager && transformedEpisodeNumber) {
        console.log(`🔄 MATCH: Checking anime relations for: "${transformedAnimeTitle}" ep${transformedEpisodeNumber}`);

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
                    console.log(`🔍 MATCH: Could not fetch anime titles from AniList:`, error.message);
                  }
                }

                // Check if the original anime title matches our current title (case-insensitive)
                if (originalTitle && originalTitle.toLowerCase() === transformedAnimeTitle.toLowerCase()) {
                  console.log(`✅ MATCH: Found matching anime relations mapping!`);
                  console.log(`🔄 MATCH: "${originalTitle}" ep${mapping.originalEpisode} -> "${mappedTitle}" ep${mapping.mappedEpisode}`);

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
              console.log(`✅ MATCH: Applying anime relations mapping: "${foundMapping.originalTitle}" ep${foundMapping.originalEpisode} -> "${foundMapping.mappedTitle}" ep${foundMapping.mappedEpisode}`);
              transformedAnimeTitle = foundMapping.mappedTitle;
              transformedEpisodeNumber = foundMapping.mappedEpisode;
            } else {
              console.log(`ℹ️  MATCH: No anime relations mapping found for: "${transformedAnimeTitle}" ep${transformedEpisodeNumber}`);
            }
          } else {
            console.log(`⚠️  MATCH: No anime relations data available`);
          }
        } catch (error) {
          console.error(`❌ MATCH: Error applying anime relations mapping:`, error);
        }
      } else {
        console.log(`⏭️  MATCH: No anime relations manager or episode number for relations mapping`);
      }

      console.log(`🎯 MATCH: Final transformed title: "${transformedAnimeTitle}" (original: "${parsedData.animeTitle}")`);
      console.log(`🎯 MATCH: Final transformed episode: ${transformedEpisodeNumber} (original: ${parsedData.episodeNumber})`);


      const titleLower = title.toLowerCase();
      const animeTitle = transformedAnimeTitle.toLowerCase();
      const episodeNumber = transformedEpisodeNumber;

      console.log(`📋 MATCH: Checking against ${whitelistEntries.length} whitelist entries:`);
      whitelistEntries.forEach((entry, index) => {
        console.log(`  ${index + 1}. "${entry.title}" (ID: ${entry.id})`);
      });

      for (const entry of whitelistEntries) {
        console.log(`🎯 MATCH: Trying whitelist entry: "${entry.title}" (ID: ${entry.id})`);
        console.log(`🎯 MATCH: Comparing transformed title "${animeTitle}" against whitelist entry "${entry.title.toLowerCase()}"`);

        // Try different matching strategies
        const matchResult = await this.tryMatchEntry(entry, title, titleLower, animeTitle, episodeNumber, parsedData);
        if (matchResult) {
          console.log(`✅ MATCH: Found match with entry: "${entry.title}"`);

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
        } else {
          console.log(`❌ MATCH: No match with entry: "${entry.title}"`);
        }
      }

      console.log(`🚫 MATCH: No whitelist matches found for: "${title}"`);

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
      console.log(`🔍 MATCH: Trying entry "${entry.title}" against "${originalTitle}"`);

      // Strategy 1: Direct title matching (existing logic)
      console.log(`📝 MATCH: Strategy 1 - Direct title matching`);
      if (titleLower.includes(entry.title.toLowerCase())) {
        console.log(`✅ MATCH: Title contains whitelist entry title`);
        if (this.checkKeywordsAndQuality(entry, titleLower, parsedData)) {
          console.log(`✅ MATCH: Keywords and quality check passed`);
          return true;
        } else {
          console.log(`❌ MATCH: Keywords or quality check failed`);
        }
      } else {
        console.log(`❌ MATCH: Title does not contain whitelist entry title`);
      }

      // Strategy 2: Anime title matching (from parsed data)
      console.log(`📝 MATCH: Strategy 2 - Anime title matching (parsed: "${animeTitle}")`);
      if (animeTitle && animeTitle.includes(entry.title.toLowerCase())) {
        console.log(`✅ MATCH: Parsed anime title contains whitelist entry title`);
        if (this.checkKeywordsAndQuality(entry, titleLower, parsedData)) {
          console.log(`✅ MATCH: Keywords and quality check passed`);
          return true;
        } else {
          console.log(`❌ MATCH: Keywords or quality check failed`);
        }
      } else {
        console.log(`❌ MATCH: Parsed anime title does not contain whitelist entry title`);
      }

      // Strategy 3: AniList-based matching with relations
      if (entry.anilist_id && animeRelationsManager) {
        console.log(`📝 MATCH: Strategy 3 - AniList-based matching (AniList ID: ${entry.anilist_id})`);
        const matchResult = await this.tryAniListMatching(entry, animeTitle, episodeNumber, parsedData);
        if (matchResult && this.checkKeywordsAndQuality(entry, titleLower, parsedData)) {
          console.log(`✅ MATCH: AniList matching and quality check passed`);
          return true;
        } else {
          console.log(`❌ MATCH: AniList matching or quality check failed`);
        }
      } else {
        console.log(`⏭️  MATCH: No AniList ID or relations manager, skipping AniList matching`);
      }

      console.log(`❌ MATCH: All strategies failed for entry "${entry.title}"`);
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
      console.log(`🔍 FILTER: Checking keywords and quality for entry "${entry.title}"`);

      // Check keywords if specified
      if (entry.keywords) {
        const keywords = entry.keywords.split(',').map(k => k.trim().toLowerCase());
        console.log(`📝 FILTER: Required keywords: [${keywords.join(', ')}]`);
        const hasAllKeywords = keywords.every(keyword =>
          keyword === '' || titleLower.includes(keyword)
        );
        if (!hasAllKeywords) {
          console.log(`❌ FILTER: Missing required keywords`);
          return false;
        } else {
          console.log(`✅ FILTER: All required keywords found`);
        }
      } else {
        console.log(`⏭️  FILTER: No required keywords specified`);
      }

      // Check exclude keywords if specified
      if (entry.exclude_keywords) {
        const excludeKeywords = entry.exclude_keywords.split(',').map(k => k.trim().toLowerCase());
        console.log(`📝 FILTER: Exclude keywords: [${excludeKeywords.join(', ')}]`);
        const hasExcludeKeyword = excludeKeywords.some(keyword =>
          keyword !== '' && titleLower.includes(keyword)
        );
        if (hasExcludeKeyword) {
          console.log(`❌ FILTER: Found exclude keyword`);
          return false;
        } else {
          console.log(`✅ FILTER: No exclude keywords found`);
        }
      } else {
        console.log(`⏭️  FILTER: No exclude keywords specified`);
      }

      // Check quality preference if specified
      if (entry.quality && entry.quality !== 'any') {
        console.log(`📝 FILTER: Required quality: ${entry.quality}`);
        if (!titleLower.includes(entry.quality.toLowerCase())) {
          console.log(`❌ FILTER: Quality requirement not met`);
          return false;
        } else {
          console.log(`✅ FILTER: Quality requirement met`);
        }
      } else {
        console.log(`⏭️  FILTER: No quality requirement specified`);
      }

      // Check release group preference if specified
      const preferredGroup = entry.preferred_group || entry.group; // Support both field names
      if (preferredGroup && preferredGroup !== 'any' && parsedData && parsedData.releaseGroup) {
        console.log(`📝 FILTER: Required release group: ${preferredGroup}`);
        console.log(`📝 FILTER: Detected release group: ${parsedData.releaseGroup}`);

        if (parsedData.releaseGroup !== preferredGroup) {
          console.log(`❌ FILTER: Release group mismatch - wanted "${preferredGroup}", got "${parsedData.releaseGroup}"`);
          return false;
        } else {
          console.log(`✅ FILTER: Release group requirement met`);
        }
      } else if (preferredGroup && preferredGroup !== 'any') {
        console.log(`⚠️  FILTER: Release group preference "${preferredGroup}" specified but no parsed data available`);
      } else {
        console.log(`⏭️  FILTER: No release group preference specified or set to "any"`);
      }

      console.log(`✅ FILTER: All filters passed for entry "${entry.title}"`);
      return true;
    },

    generateFinalTitle(originalTitle, whitelistEntry, parsedData = null) {
      console.log(`🏷️  TITLE: Generating final title for "${originalTitle}" with entry "${whitelistEntry.title}"`);

      let episodeNumber = null;
      let episodeTitle = '';

      if (parsedData) {
        episodeNumber = parsedData.episodeNumber;
        episodeTitle = parsedData.episodeTitle;
        console.log(`📊 TITLE: Using parsed data - Episode: ${episodeNumber}, Title: ${episodeTitle}`);

        // Check for episode mapping if we have AniList ID and relations
        if (whitelistEntry.anilist_id && episodeNumber && animeRelationsManager) {
          console.log(`🔄 TITLE: Checking episode mapping for AniList ID ${whitelistEntry.anilist_id}, episode ${episodeNumber}`);
          const mapping = animeRelationsManager.getEpisodeMapping(whitelistEntry.anilist_id, parseInt(episodeNumber));
          if (mapping) {
            const originalEp = episodeNumber;
            episodeNumber = mapping.mappedEpisode.toString();
            console.log(`✅ TITLE: Applied episode mapping: ${originalEp} -> ${episodeNumber}`);
          } else {
            console.log(`⏭️  TITLE: No episode mapping found`);
          }
        } else {
          console.log(`⏭️  TITLE: No AniList ID or relations manager for episode mapping`);
        }
      } else {
        // Fallback to regex extraction
        console.log(`📝 TITLE: No parsed data, using regex fallback`);
        const episodeMatch = originalTitle.match(/(?:episode?\s*|ep\.?\s*|e)(\d+)/i);
        episodeNumber = episodeMatch ? episodeMatch[1] : null;
        console.log(`📊 TITLE: Regex extracted episode: ${episodeNumber}`);
      }

      // Apply title overrides and episode mappings
      let finalTitle = whitelistEntry.title;
      let finalEpisodeNumber = episodeNumber;

      if (titleOverridesManager) {
        console.log(`🔄 TITLE: Applying title overrides to "${finalTitle}"`);

        // First apply title overrides
        const overriddenTitle = titleOverridesManager.applyOverrides(finalTitle);
        if (overriddenTitle !== finalTitle) {
          console.log(`✅ TITLE: Applied title override: "${finalTitle}" -> "${overriddenTitle}"`);
          finalTitle = overriddenTitle;
        }

        // Then apply episode mappings (can change both title and episode)
        if (finalEpisodeNumber) {
          const mappingResult = titleOverridesManager.applyEpisodeMappings(finalTitle, parseInt(finalEpisodeNumber));
          if (mappingResult.transformedTitle !== finalTitle || mappingResult.transformedEpisode !== parseInt(finalEpisodeNumber)) {
            console.log(`✅ TITLE: Applied episode mapping: "${finalTitle}" episode ${finalEpisodeNumber} -> "${mappingResult.transformedTitle}" episode ${mappingResult.transformedEpisode}`);
            finalTitle = mappingResult.transformedTitle;
            finalEpisodeNumber = mappingResult.transformedEpisode.toString();
          }
        }
      } else {
        console.log(`⏭️  TITLE: No title overrides manager available`);
      }

      console.log(`🏗️  TITLE: Base title after overrides: "${finalTitle}"`);

      if (finalEpisodeNumber) {
        const paddedEpisode = finalEpisodeNumber.padStart(2, '0');
        finalTitle += ` - Episode ${paddedEpisode}`;
        console.log(`📺 TITLE: Added episode number: "${paddedEpisode}"`);
      }

      if (episodeTitle) {
        finalTitle += ` - ${episodeTitle}`;
        console.log(`📝 TITLE: Added episode title: "${episodeTitle}"`);
      }

      console.log(`🎯 TITLE: Final generated title: "${finalTitle}"`);
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
        return {
          success: false,
          error: error.message
        };
      }
    },

    async testFeed(rssUrl) {
      try {
        console.log('Testing RSS feed:', rssUrl);

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
        throw new Error(`RSS feed test failed: ${error.message}`);
      }
    },

    async testRSSDownload(rssUrl, options = {}) {
      try {
        console.log('🧪 TEST: Starting RSS download test for:', rssUrl);
        console.log('🧪 TEST: Options:', options);

        // Fetch RSS feed using the same logic as processFeed
        const response = await axios.get(rssUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'MoeDownloader/1.0'
          }
        });

        console.log('📡 RSS: Response received, size:', response.data.length, 'bytes');

        // Parse XML
        const parser = new xml2js.Parser();
        const parsedResult = await parser.parseStringPromise(response.data);

        if (!parsedResult.rss || !parsedResult.rss.channel || !parsedResult.rss.channel[0].item) {
          throw new Error('Invalid RSS feed format');
        }

        const items = parsedResult.rss.channel[0].item;
        console.log(`🧪 TEST: Found ${items.length} RSS items to process`);

        let processedCount = 0;
        let downloadedCount = 0;
        const testResults = [];

        // Get whitelist entries (same as real implementation)
        const whitelistEntries = whitelistOperations.getAll().filter(entry => entry.enabled);
        console.log(`🧪 TEST: Found ${whitelistEntries.length} enabled whitelist entries`);

        // Process items (limit to first few for testing if specified)
        const itemsToProcess = options.maxItems ? items.slice(0, options.maxItems) : items;
        console.log(`🧪 TEST: Processing ${itemsToProcess.length} items (limited by maxItems: ${options.maxItems || 'none'})`);

        for (const item of itemsToProcess) {
          try {
            const guid = item.guid?.[0]?._ || item.guid?.[0] || item.link?.[0];
            const title = item.title?.[0] || '';
            const link = item.link?.[0] || '';
            const pubDate = item.pubDate?.[0] || '';

            console.log(`🧪 TEST: Processing item: "${title}"`);

            if (!guid || !title || !link) {
              console.warn('⚠️  RSS: Skipping item with missing required fields:', { guid, title, link });
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
            console.log(`🧪 TEST: Adding RSS entry to database (test mode)...`);
            const rssResult = rssOperations.add(null, `TEST_${guid}`, `TEST: ${title}`, link, pubDate);
            const rssId = rssResult.lastInsertRowid;
            console.log(`✅ RSS: Added test RSS entry with ID: ${rssId}`);
            processedCount++;

            // Check against whitelist with enhanced matching (same as real implementation)
            console.log(`🎯 RSS: Checking whitelist matches for: "${title}"`);
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

              // Check if this episode was already processed (same logic as real implementation)
              const episodeNumber = matchResult.parsedData?.episodeNumber || '';
              const animeTitle = matchResult.parsedData?.animeTitle || matchResult.entry.title;

              console.log(`🔍 RSS: Checking processed files for:`, {
                whitelistEntryId: matchResult.entry.id,
                episodeNumber,
                animeTitle,
                originalTitle: title
              });

              const alreadyProcessed = processedFilesOperations.exists(
                matchResult.entry.id,
                episodeNumber,
                animeTitle
              );

              if (alreadyProcessed && !options.ignoreProcessedFiles) {
                console.log(`⏭️  RSS: Episode already processed in database, skipping: "${title}"`);
                result.status = 'already_processed';
                result.reason = 'Episode already processed in database';
              } else {
                console.log(`✅ RSS: Episode not yet processed, proceeding with download: "${title}"`);

                // Create download (same logic as real implementation)
                console.log(`🏗️  RSS: Generating final title for download...`);
                const finalTitle = this.generateFinalTitle(title, matchResult.entry, matchResult.parsedData);
                console.log(`🏷️  RSS: Generated final title: "${finalTitle}"`);

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
        return {
          success: false,
          error: error.message,
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
        return {
          success: false,
          error: error.message,
          rssUrl: rssUrl
        };
      }
    }
  };

  return processor;
}

module.exports = { createRSSProcessor };
