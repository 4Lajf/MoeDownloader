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

function createRSSProcessor(notificationService = null, anilistService = null) {
  let animeRelationsManager = null;

  const processor = {
    async initialize() {
      try {
        animeRelationsManager = createAnimeRelationsManager();
        await animeRelationsManager.initialize();
        console.log('RSS processor initialized with anime relations support');
      } catch (error) {
        console.error('Failed to initialize anime relations in RSS processor:', error);
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

      const titleLower = title.toLowerCase();
      const animeTitle = parsedData.animeTitle.toLowerCase();
      const episodeNumber = parsedData.episodeNumber ? parseInt(parsedData.episodeNumber) : null;

      for (const entry of whitelistEntries) {
        console.log(`🎯 MATCH: Trying whitelist entry: "${entry.title}" (ID: ${entry.id})`);
        // Try different matching strategies
        const matchResult = await this.tryMatchEntry(entry, title, titleLower, animeTitle, episodeNumber, parsedData);
        if (matchResult) {
          console.log(`✅ MATCH: Found match with entry: "${entry.title}"`);
          return { entry, parsedData };
        } else {
          console.log(`❌ MATCH: No match with entry: "${entry.title}"`);
        }
      }

      console.log(`🚫 MATCH: No whitelist matches found for: "${title}"`);
      return { entry: null, parsedData };
    },

    async tryMatchEntry(entry, originalTitle, titleLower, animeTitle, episodeNumber, parsedData) {
      console.log(`🔍 MATCH: Trying entry "${entry.title}" against "${originalTitle}"`);

      // Strategy 1: Direct title matching (existing logic)
      console.log(`📝 MATCH: Strategy 1 - Direct title matching`);
      if (titleLower.includes(entry.title.toLowerCase())) {
        console.log(`✅ MATCH: Title contains whitelist entry title`);
        if (this.checkKeywordsAndQuality(entry, titleLower)) {
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
        if (this.checkKeywordsAndQuality(entry, titleLower)) {
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
        if (matchResult && this.checkKeywordsAndQuality(entry, titleLower)) {
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

    checkKeywordsAndQuality(entry, titleLower) {
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

      // Build final title
      let finalTitle = whitelistEntry.title;
      console.log(`🏗️  TITLE: Base title: "${finalTitle}"`);

      if (episodeNumber) {
        const paddedEpisode = episodeNumber.padStart(2, '0');
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
            error: null
          };

          if (parsedData) {
            console.log(`🧪 TEST: Parsed data:`, {
              animeTitle: parsedData.animeTitle,
              episodeNumber: parsedData.episodeNumber,
              releaseGroup: parsedData.releaseGroup,
              videoResolution: parsedData.videoResolution
            });

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
