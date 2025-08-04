// @ts-check

/**
 * RSS Feed Torrent Downloader and Processor
 *
 * This script performs the following tasks:
 *
 * 1. Fetches an RSS feed from a specified URL (nyaa.si) at regular intervals.
 * 2. Parses the RSS feed to extract information about new anime releases.
 * 3. Filters the releases based on a whitelist of allowed titles.
 * 4. Downloads torrent files for whitelisted anime releases using WebTorrent.
 * 5. Manages a queue system for downloading multiple torrents.
 * 6. Renames downloaded files to maintain consistency and fix known title issues.
 * 7. Keeps track of processed entries to avoid duplicate downloads.
 * 8. Implements error handling and logging for various operations.
 * 9. Provides console output with color-coding for different types of messages.
 * 10. Sends debug information to a Discord webhook for monitoring.
 * 11. Handles graceful shutdown and cleans up resources.
 * 12. Supports command-line arguments for manual torrent downloads.
 * 13. Uses a cron job to schedule regular checks for new RSS feed entries.
 * 14. Implements retry logic for RSS feed fetching in case of failures.
 * 15. Manages file operations for storing processed IDs, titles, and other metadata.
 * 16. Provides progress bars for ongoing downloads.
 * 17. Formats file sizes and speeds for better readability.
 * 18. Handles various edge cases and specific requirements for certain anime titles.
 * 19. Initiates a clearing process after downloads are completed.
 * 20. Utilizes environment variables for configuration.
 *
 * The script is designed to automate the process of monitoring and downloading
 * new anime releases from a specific RSS feed, with features to ensure efficient
 * operation, error recovery, and detailed logging for troubleshooting.
 */

import { config } from 'dotenv';
config();
import path from 'path';
import axios from 'axios';
import WebTorrent from 'webtorrent';
import cron from 'node-cron';
import fs from 'fs';
import ProgressBar from 'progress';
import { parseStringPromise } from 'xml2js';
// @ts-ignore
import * as cp from 'child_process';

const FEED_URL = 'https://nyaa.si/?page=rss&c=1_2&f=0';
const MAX_ATTEMPTS = 3;
const SLEEP_DURATION = 10000;
const MINUTES_SCHEDULE = 5;
let title;
/**
 * File paths used by the script
 * @typedef {Object} FilePaths
 * @property {string} LAST_ID_FILE - Path to the file storing the last processed ID
 * @property {string} IS_RUNNING_FILE - Path to the file indicating if the script is running
 * @property {string} PROCESSED_TITLES_FILE - Path to the file storing processed titles
 * @property {string} PROCESSED_IDS_FILE - Path to the file storing processed IDs
 * @property {string} WHITELIST_FILE - Path to the file containing the whitelist
 * @property {string} DOWNLOADS_DIR - Path to the downloads directory
 */
const FILE_PATHS = {
  LAST_ID_FILE: 'app/0rss/lastId.txt',
  IS_RUNNING_FILE: 'app/isRunning.txt',
  PROCESSED_TITLES_FILE: 'app/0rss/processedTitles.txt',
  PROCESSED_IDS_FILE: 'app/0rss/processed_ids.txt',
  WHITELIST_FILE: 'app/0rss/whitelist.json',
  DOWNLOADS_DIR: 'app/0rss/downloads',
  SUBSPLEASE_SEASON_MAPPING_FILE: 'app/0rss/subsplease_season_mapping.json',
};

const logsDir = 'app/logs';
createDirectoryIfNotExists(logsDir);

const infoLogStream = createWriteStream(path.join(logsDir, 'info.log'));
const errorLogStream = createWriteStream(path.join(logsDir, 'error.log'));
const exceptionLogStream = createWriteStream(path.join(logsDir, 'exception.log'));
const rejectionLogStream = createWriteStream(path.join(logsDir, 'rejection.log'));

setupLogging();
setupUncaughtErrorHandling();

// Check if a torrent link was provided as a command-line argument
const providedLink = process.argv[2];
let activeDownloads = 0;
/**
 * @typedef {Object} DownloadQueue
 * @property {string[]} torrentLinks
 * @property {string[]} torrentTitles
 * @property {(string|undefined)[]} finalTitles
 */

/** @type {DownloadQueue} */
const downloadQueue = { torrentLinks: [], torrentTitles: [], finalTitles: [] };

/**
 * ANSI color codes for console output
 * @constant {Object}
 */
const COLORS = {
  RESET: '\x1b[0m',
  BLACK: '\x1b[30m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  GRAY: '\x1b[90m',
  DIM: '\x1b[2m',
  BG_BLACK: '\x1b[40m',
  BG_RED: '\x1b[41m',
  BG_GREEN: '\x1b[42m',
  BG_YELLOW: '\x1b[43m',
  BG_BLUE: '\x1b[44m',
  BG_MAGENTA: '\x1b[45m',
  BG_CYAN: '\x1b[46m',
  BG_WHITE: '\x1b[47m',
};

/**
 * Schedule the script to run every MINUTES_SCHEDULE minutes
 */
cron.schedule(`*/${MINUTES_SCHEDULE} * * * *`, init);
console.info(
  `${COLORS.GRAY}[INFO] RSS downloader script started. Checking for updates every ${MINUTES_SCHEDULE} minutes.${COLORS.RESET}`
);

init();

/**
 * Initialize the script
 * @returns {void}
 */
function init() {
  if (isScriptAlreadyRunning()) {
    console.info(
      `${COLORS.GRAY}[INFO] Another instance of the script is already running. Skipping this run.${COLORS.RESET}`
    );
    return;
  }

  // If a torrent link was provided, download it directly.
  // Otherwise, process the RSS feed.
  if (providedLink) {
    downloadTorrentFromCLI(providedLink);
  } else {
    processFeed();
  }
}

/**
 * Check if the script is already running
 * @returns {boolean} - True if the script is already running, false otherwise
 */
function isScriptAlreadyRunning() {
  return fs.readFileSync(FILE_PATHS.IS_RUNNING_FILE, 'utf8').trim() === 'true';
}

async function markScriptAsRunning() {
  fs.writeFileSync(FILE_PATHS.IS_RUNNING_FILE, 'true');
  // await performDirectoryCleanup(["app/1clear/extracted", "app/3replace/clean", "app/0rss/downloads", "app/audio_processing"]);
}

// async function performDirectoryCleanup(dirsToClean) {
//   for (const dir of dirsToClean) {
//     await deleteAllFilesInDirectory(dir);
//   }
// }

// async function deleteAllFilesInDirectory(directoryPath) {
//   try {
//     const files = fs.readdirSync(directoryPath).filter((file) => file !== ".gitkeep");
//     for (const file of files) {
//       const filePath = path.join(directoryPath, file);
//       try {
//         const stats = fs.statSync(filePath);

//         if (stats.isDirectory()) {
//           // Recursively delete contents of subdirectory
//           await deleteAllFilesInDirectory(filePath);
//           // Remove the now-empty directory
//           fs.rmdirSync(filePath);
//           console.log(`${COLORS.GRAY}[INFO] Deleted directory: ${filePath}${COLORS.RESET}`);
//         } else {
//           fs.unlinkSync(filePath);
//           console.log(`${COLORS.GRAY}[INFO] Deleted file: ${filePath}${COLORS.RESET}`);
//         }
//       } catch (error) {
//         console.error(`${COLORS.RED}[ERROR] Error deleting ${filePath}: ${error.message}${COLORS.RESET}`);
//       }
//     }
//     console.info(`${COLORS.GRAY}[INFO] Completed deletion process for directory: ${directoryPath}${COLORS.RESET}`);
//   } catch (error) {
//     console.error(`${COLORS.RED}[ERROR] Error processing directory: ${directoryPath}${COLORS.RESET}`);
//     console.error(error);
//   }
// }

/**
 * Download a torrent from the provided command-line link
 * @param {string} torrentLink - The link to the torrent file
 * @returns {void}
 */
function downloadTorrentFromCLI(torrentLink) {
  console.info(`${COLORS.CYAN}[INFO] Downloading from provided link: ${torrentLink}${COLORS.RESET}`);
  enqueueDownload(torrentLink, 'CLI Provided Torrent');
}

/**
 * Enqueue a download
 * @param {string} torrentLink - The link to the torrent file
 * @param {string} torrentTitle - The title of the torrent
 * @param {string} [finalTitle] - The final title for duplicate tracking (optional, for CLI downloads)
 * @returns {void}
 */
function enqueueDownload(torrentLink, torrentTitle, finalTitle = undefined) {
  if (torrentTitle !== 'CLI Provided Torrent') {
    // if (!torrentTitle.includes('[ENG]') && !torrentTitle.includes('[FRE]')) {
    //   console.info(
    //     `${COLORS.GRAY}[INFO] Skipping due to not having both ENG and FRE tracks ${torrentTitle} ${COLORS.RESET}`
    //   );
    //   return;
    // }
    // if (!torrentTitle.includes('[ENG]')) {
    //   console.info(`${COLORS.GRAY}[INFO] Skipping due to not having ENG track ${torrentTitle} ${COLORS.RESET}`);
    //   return;
    // }
  }
  markScriptAsRunning();
  downloadQueue.torrentLinks.push(torrentLink);
  downloadQueue.torrentTitles.push(torrentTitle);
  // Store finalTitle for duplicate tracking (only for RSS downloads, not CLI)
  if (!downloadQueue.finalTitles) {
    downloadQueue.finalTitles = [];
  }
  downloadQueue.finalTitles.push(finalTitle);
  console.info(
    `${COLORS.CYAN}[INFO] Adding to queue ${torrentTitle} - ${torrentLink} [${downloadQueue.torrentLinks.length} file(s) left]${COLORS.RESET}`
  );
  if (activeDownloads === 0) {
    processNextDownload();
  }
}

/**
 * Process the next download in the queue
 * @returns {void}
 */
function processNextDownload() {
  if (downloadQueue.torrentLinks.length === 0) {
    updateLastProcessedID();
    console.info(`${COLORS.CYAN}[INFO] All files have been downloaded :)${COLORS.RESET}`);
    console.info(
      `${COLORS.WHITE}${COLORS.BG_CYAN}${COLORS.BLACK}[INFO] Proceeding to the <CLEARING> step...${COLORS.RESET}`
    );
    startClearingProcess();
    return;
  }
  const torrentLink = downloadQueue.torrentLinks.shift() ?? '';
  const torrentTitle = downloadQueue.torrentTitles.shift() ?? '';
  const finalTitle = downloadQueue.finalTitles.shift();
  downloadTorrent(torrentLink, torrentTitle, finalTitle);
}

function fixTitle(title) {
  const titleMap = {
    'NieR-Automata Ver1_1a Part 2': 'NieR_Automata Ver1.1a Part 2',
    '2-5 Jigen no Ririsa': '2.5-Jigen no Ririsa',
    'Kami no Tou - Ouji no Kikan': 'Kami no Tou 2nd Season',
    'Kami no Tou Ouji no Kikan': 'Kami no Tou 2nd Season',
    Vden: 'VTuber Nandaga Haishin Kiri Wasuretara Densetsu ni Natteta',
  };

  return titleMap[title];
}

/**
 * Download a torrent
 * @param {string} torrentLink - The link to the torrent file
 * @param {string} torrentTitle - The title of the torrent
 * @param {string|undefined} finalTitle - The final title for duplicate tracking (optional, for CLI downloads)
 * @returns {void}
 */
function downloadTorrent(torrentLink, torrentTitle, finalTitle) {
  console.info(`${COLORS.CYAN}[INFO] Downloading ${torrentTitle}...${COLORS.RESET}`);
  activeDownloads++;

  try {
    const client = new WebTorrent();
    client.add(torrentLink, { path: FILE_PATHS.DOWNLOADS_DIR }, (torrent) => {
      // @ts-ignore
      const bar = createProgressBar(torrent);
      let updateInterval = setInterval(() => {
        // @ts-ignore
        updateProgressBar(bar, torrent);
        if (torrent.done) {
          let oldFilename = torrent.files[0].name;
          let newFilename = torrent.files[0].name;

          // Check if this is a ToonsHub file
          const isToonsHub = oldFilename.includes('ToonsHub');

          if (!isToonsHub) {
            // Check if this was originally a SubsPlease file and apply season mapping
            const isOriginalSubsPlease = oldFilename.includes('[SubsPlease]');
            if (isOriginalSubsPlease) {
              const subspleaseSeasonMapping = loadSubsPleasSeasonMapping();
              // Apply season mapping to the original SubsPlease filename
              const mappedTitle = applySubsPleasSeasonMapping(oldFilename, subspleaseSeasonMapping);
              newFilename = mappedTitle;
              console.info(`${COLORS.CYAN}[INFO] SubsPlease file renamed from: ${oldFilename}${COLORS.RESET}`);
              console.info(`${COLORS.CYAN}[INFO] SubsPlease file renamed to: ${newFilename}${COLORS.RESET}`);
            }

            // Handle Erai-raws, SubsPlease, and New-raws files
            let titleMatch = oldFilename.match(/(.+)\s-\s(\d{2})/);
            if (!titleMatch) {
              throw new Error('Failed to extract title');
            }
            // Remove any release group prefix
            const animeTitle = titleMatch[1]
              .replace('[Erai-raws] ', '')
              .replace('[SubsPlease] ', '')
              .replace('[New-raws] ', '');
            let fixedTitle = fixTitle(animeTitle);
            if (fixedTitle) {
              newFilename = oldFilename.replace(animeTitle, fixedTitle);
            }
          }
          // For ToonsHub files, we keep the original filename

          // Only rename if the filenames are different
          if (oldFilename !== newFilename) {
            fs.renameSync(`app/0rss/downloads/${oldFilename}`, `app/0rss/downloads/${newFilename}`);
          }
          activeDownloads--;
          clearInterval(updateInterval);
          console.info(`${COLORS.CYAN}[INFO] Download completed for: ${torrentTitle}${COLORS.RESET}`);
          sendDebugInfoToDiscord(`[INFO] Download completed for: ${torrentTitle}`);

          // Add to processed titles only after download completes (not for CLI downloads)
          if (finalTitle) {
            // Check if this title was already processed by another download that finished first
            const [currentProcessedTitles] = loadProcessedData();
            if (!isTitleProcessed(finalTitle, currentProcessedTitles)) {
              fs.appendFileSync(FILE_PATHS.PROCESSED_TITLES_FILE, finalTitle + '\n');
              console.info(`${COLORS.GRAY}[INFO] Added to processed titles: ${finalTitle}${COLORS.RESET}`);
            } else {
              console.info(`${COLORS.YELLOW}[INFO] Title already processed by another download, skipping: ${finalTitle}${COLORS.RESET}`);
            }
          }

          processNextDownload();
        }
      }, 1000);
    });
  } catch (error) {
    console.error(`${COLORS.RED}[ERROR] Error downloading: ${torrentTitle}${COLORS.RESET}`);
    throw new Error(error);
  }
}

/**
 * Update the progress bar
 * @param {ProgressBar} bar - The progress bar instance
 * @param {WebTorrent} torrent - The torrent object
 * @returns {void}
 */
function updateProgressBar(bar, torrent) {
  // @ts-ignore
  const percent = (torrent.progress * 100).toFixed(2);
  // @ts-ignore
  const downloadSpeed = formatBytes(torrent.downloadSpeed) + '/s';
  // @ts-ignore
  const downloaded = formatBytes(torrent.downloaded);
  const total = formatBytes(torrent.length);
  // @ts-ignore
  bar.fmt = `Downloading [:bar] ${percent}% | Speed: ${downloadSpeed} | Downloaded: ${downloaded} / ${total}`;
  // @ts-ignore
  bar.update(torrent.progress, { torrent });
}

/**
 * Create a progress bar
 * @param {WebTorrent} torrent - The torrent object
 * @returns {ProgressBar} - The created progress bar instance
 */
function createProgressBar(torrent) {
  return new ProgressBar('Downloading [:bar] 0.00% | Speed: 0.00 KB/s | Downloaded: 0 Bytes / 0 Bytes', {
    total: torrent.length,
    width: 40,
    complete: '=',
    incomplete: ' ',
  });
}

/**
 * Process the RSS feed
 * @returns {Promise<void>}
 */
async function processFeed() {
  const whitelist = loadWhitelist();
  const subspleaseSeasonMapping = loadSubsPleasSeasonMapping();
  let lastProcessedID = getLastProcessedID();
  console.info(`${COLORS.GRAY}[INFO] Last processed ID from previous run: ${lastProcessedID}${COLORS.RESET}`);
  console.info(`${COLORS.GRAY}[INFO] Checking for new RSS feed entries...${COLORS.RESET}`);

  const feed = await fetchRSS(FEED_URL);
  const items = feed.rss.channel[0].item;

  // loop over the received items from the RSS query
  for (const item of items) {
    const [processedTitles, processedIDs] = loadProcessedData();
    const currentGuid = item.guid[0]['_'] ? item.guid[0]['_'].trim() : 'none'; // check if item has 'guid', else output 'none'
    const currentID = extractIDFromGuid(currentGuid);

    // If there are no new entries e.g. lastProcessedID is greater or euqal currentID doesn't exist or if currentID or lastProcessedID doesn't exist
    if (!currentID || !lastProcessedID || lastProcessedID >= currentID) {
      handleNoNewEntries();
      return;
    }

    if (isIDProcessed(currentID, processedIDs)) {
      console.info(`${COLORS.GRAY}[INFO] ID ${currentID} has already been processed. Skipping...${COLORS.RESET}`);
      continue;
    }
    console.info(`${COLORS.GRAY}[INFO] New entry detected with ID: ${currentID}${COLORS.RESET}`);
    fs.appendFileSync(FILE_PATHS.PROCESSED_IDS_FILE, `${currentID}\n`);

    // Check for SubsPlease releases and treat them the same as Erai-raws
    const isSubsPlease = item.title[0].includes('[SubsPlease]');

    // Skip SubsPlease releases that aren't 1080p (to match Erai-raws behavior)
    if (isSubsPlease && !item.title[0].includes('(1080p)')) {
      console.info(`${COLORS.GRAY}[INFO] Skipping non-1080p SubsPlease release: ${item.title[0]}${COLORS.RESET}`);
      continue;
    }

    // Check for New-raws releases and treat them the same as Erai-raws
    const isNewRaws = item.title[0].includes('[New-raws]');

    // Skip New-raws releases that aren't 1080p (to match Erai-raws behavior)
    if (isNewRaws && !item.title[0].includes('[1080p]')) {
      console.info(`${COLORS.GRAY}[INFO] Skipping non-1080p New-raws release: ${item.title[0]}${COLORS.RESET}`);
      continue;
    }

    // Check if this is a ToonsHub title
    const isToonsHub = item.title[0].includes('[ToonsHub]');

    // Skip ToonsHub H.265 releases
    if (isToonsHub && item.title[0].includes('H.265')) {
      console.info(`${COLORS.GRAY}[INFO] Skipping ToonsHub H.265 release: ${item.title[0]}${COLORS.RESET}`);
      continue;
    }

    // Skip ToonsHub releases that don't contain "CR" in the title
    if (isToonsHub && (!item.title[0].toLowerCase().includes('cr') || !item.title[0].toLowerCase().includes('hidive') || !item.title[0].toLowerCase().includes('amzn'))) {
      console.info(`${COLORS.GRAY}[INFO] Skipping ToonsHub release without CR: ${item.title[0]}${COLORS.RESET}`);
      continue;
    }

    // Store the original title before any normalization for group detection
    const originalTitle = item.title[0];

    if (!isToonsHub) {
      // Apply SubsPlease season mapping before normalization
      if (isSubsPlease) {
        item.title[0] = applySubsPleasSeasonMapping(item.title[0], subspleaseSeasonMapping);
      }

      // Handle Erai-raws, SubsPlease, or New-raws titles - normalize to Erai-raws format for processing
      item.title[0] = item.title[0]
        .replace('[SubsPlease]', '[Erai-raws]').replace('(1080p)', '[1080p]')
        .replace('[New-raws]', '[Erai-raws]');
    }

    const fullTitle = extractFilename(item.title[0]);
    if (!fullTitle) {
      console.info(`${COLORS.GRAY}[INFO] ${item.title[0]} does not meet title criteria.${COLORS.RESET}`);
      continue;
    }

    let finalTitle;
    let titleMatch = null;
    let episodeNumberMatch = null;

    if (isToonsHub) {
      // For ToonsHub titles, we keep the full title for now
      finalTitle = fullTitle;
    } else {
      // For Erai-raws titles, we clean up the title
      finalTitle = fullTitle.replace('[Erai-raws] ', '').replace(' [1080p]', '');

      // Matches a title followed by a space, hyphen, space, and exactly two digits
      // Example: "Show Title - 05"
      // Group 1: Show title (e.g., "Show Title")
      // Group 2: Two-digit number (e.g., "05")
      titleMatch = finalTitle.match(/(.+)\s-\s(\d{2})/);

      // Matches any text, a space, hyphen, space, followed by one or more digits
      // Example: "Show Title - 5 - Episode Name" or "Show Title - 105"
      // Group 1: Episode number (e.g., "5" or "105")
      episodeNumberMatch = finalTitle.match(/.*\s-\s(\d+)(?=\s*\[|$)/);

      if (!titleMatch || !titleMatch[1] || !episodeNumberMatch || !episodeNumberMatch[1]) {
        continue;
      }
    }

    // Apply title fixes for Erai-raws titles
    if (!isToonsHub && titleMatch && episodeNumberMatch) {
      let fixedTitle = fixTitle(titleMatch[1]);
      if (fixedTitle) {
        finalTitle = `${fixedTitle} - ${episodeNumberMatch[1]}`;
      }
    }
    // Note: Title will be added to processed list only after download completes

    // @ts-ignore
    if (item.title[0].includes('HEVC')) {
      console.info(`${COLORS.GRAY}[INFO] Skipping valid HEVC entry to avoid duplication ${finalTitle}${COLORS.RESET}`);
      continue;
    }

    // @ts-ignore
    if (isTitleProcessed(finalTitle, processedTitles)) {
      console.info(
        // @ts-ignore
        `${COLORS.GRAY}[INFO] This entry was already processed. Skipping... "${finalTitle.trim()}"${COLORS.RESET}`
      );
      continue;
    }
    updateLastProcessedID();
    await processNewEntry(item, currentID, processedTitles, whitelist, originalTitle);
  }
  `${COLORS.GRAY}[INFO] All entries processed"${COLORS.RESET}`;

  updateLastProcessedID();
}

/**
 * Extract the ID from a GUID
 * @param {string} guid - The GUID string
 * @returns {number|null} - The extracted ID or null if not found
 */
function extractIDFromGuid(guid) {
  /**
   * Matches and extracts the first occurrence of one or more digits in the `guid` string.
   * @type {RegExpMatchArray|null}
   */
  const match = guid.match(/(\d+)/);
  return match ? parseInt(match[0]) : null;
}

/**
 * Get the last processed ID
 * @returns {number|null} - The last processed ID or null if not found
 */
function getLastProcessedID() {
  if (fs.existsSync(FILE_PATHS.LAST_ID_FILE)) {
    return parseInt(fs.readFileSync(FILE_PATHS.LAST_ID_FILE, 'utf8').trim(), 10);
  }
  return null;
}

/**
 * Handle the case when no new entries are found
 * @returns {void}
 */
function handleNoNewEntries() {
  console.info(`${COLORS.GRAY}[INFO] No new entries found.${COLORS.RESET}`);
  updateLastProcessedID();
  stopRunning();
}

/**
 * Process a new entry
 * @param {Object} item - The RSS feed item
 * @param {number} currentID - The current ID
 * @param {string[]} processedTitles - The array of processed titles
 * @param {Object[]} whitelist - The unified whitelist array for all sources
 * @param {string} originalTitle - The original title before normalization
 * @returns {Promise<void>}
 */
async function processNewEntry(item, currentID, processedTitles, whitelist, originalTitle) {
  const fullTitle = item.title[0];
  const finalTitle = extractFilename(fullTitle);
  const whitelistTitle = extractWhitelistFilename(fullTitle);

  // Determine the release group from the ORIGINAL title before any normalization
  // This ensures we get the correct group for whitelist matching
  let releaseGroup = '';
  if (originalTitle.includes('[ToonsHub]')) {
    releaseGroup = 'ToonsHub';
  } else if (originalTitle.includes('[SubsPlease]')) {
    releaseGroup = 'SubsPlease';
  } else if (originalTitle.includes('[New-raws]')) {
    releaseGroup = 'New-raws';  // Fixed: should be 'New-raws' not 'NewRaws' to match whitelist
  } else if (originalTitle.includes('[Erai-raws]')) {
    releaseGroup = 'Erai-raws';
  }

  // For ToonsHub, only download H.264 releases, skip H.265 releases
  if (releaseGroup === 'ToonsHub' && fullTitle.includes('H.265')) {
    console.info(`${COLORS.GRAY}[INFO] Skipping ToonsHub H.265 release: ${fullTitle}${COLORS.RESET}`);
    return;
  }

  // For ToonsHub, only download releases that contain "CR"
  if (releaseGroup === 'ToonsHub' && (!fullTitle.toLowerCase().includes('hidive') || !fullTitle.toLowerCase().includes('cr') || !fullTitle.toLowerCase().includes('amzn'))) {
    console.info(`${COLORS.GRAY}[INFO] Skipping ToonsHub release without CR: ${fullTitle}${COLORS.RESET}`);
    return;
  }

  if (finalTitle && whitelistTitle && (await handleWhitelist(whitelistTitle, whitelist, releaseGroup))) {
    await handleTitleProcessing(item, fullTitle, finalTitle, processedTitles);
  }
}

/**
 * Handle the whitelist check
 * @param {string} whitelistTitle - The title to check against the whitelist
 * @param {Object[]} whitelist - The unified whitelist array
 * @param {string} releaseGroup - The release group (Erai-raws, SubsPlease, New-raws, ToonsHub)
 * @returns {Promise<boolean>} - True if the title is whitelisted, false otherwise
 */
async function handleWhitelist(whitelistTitle, whitelist, releaseGroup = '') {
  const whitelistEntry = whitelist.find((item) =>
    whitelistTitle.trim().toLowerCase() === item.title.trim().toLowerCase()
  );

  if (!whitelistEntry) {
    console.info(`${COLORS.YELLOW}[INFO] "${whitelistTitle}" is not on the whitelist.json. Skipping...${COLORS.RESET}`);
    return false;
  }

  // If group preference is "any", accept any release group
  if (whitelistEntry.group === 'any') {
    return true;
  }

  // Check if the release group matches the preferred group
  if (whitelistEntry.group !== releaseGroup) {
    console.info(`${COLORS.YELLOW}[INFO] "${whitelistTitle}" prefers group "${whitelistEntry.group}" but got "${releaseGroup}". Skipping...${COLORS.RESET}`);
    return false;
  }

  return true;
}

/**
 * Handle the title processing
 * @param {Object} item - The RSS feed item
 * @param {string} fullTitle - The full title of the item
 * @param {string} finalTitle - The extracted final title
 * @param {string[]} processedTitles - The array of processed titles
 * @returns {Promise<void>}
 */
async function handleTitleProcessing(item, fullTitle, finalTitle, processedTitles) {
  markScriptAsRunning();

  let [title, episodeNumber] = extractTitleAndEpisode(finalTitle, fullTitle);
  let fixedTitle = fixTitle(title);
  if (fixedTitle) {
    title = fixedTitle;
  }
  console.info(`${COLORS.CYAN}[INFO] ${finalTitle.trim()} "${fullTitle.trim()}"${COLORS.RESET}`);

  enqueueDownload(item.link[0], fullTitle, finalTitle);
}
/**
 * Extract the title and episode number from the final title
 * @param {string} finalTitle - The final title
 * @param {string} fullTitle - The final title
 * @returns {string[]} - An array containing the extracted title and episode number
 */
// @ts-ignore
function extractTitleAndEpisode(finalTitle, fullTitle) {
  // Check if this is a ToonsHub title
  if (fullTitle.includes('[ToonsHub]')) {
    return extractToonsHubTitleAndEpisode(finalTitle, fullTitle);
  }

  /**
   * The regular expression assumes the title is enclosed in square brackets on the outside like that "[abc] <title> [xyz]",
   * followed by a space, a hyphen, another space, and the episode number.
   */
  const titleMatch = finalTitle.match(/\]\s(.*?)\s-\s(\d+)/);
  if (!titleMatch) {
    throw new Error('Invalid title format');
  }
  const title = titleMatch[1];

  /**
   * The episode number is assumed to be one or more digits a hyphen behind "- <digits>" it and optional spaces.
   */
  const episodeMatch = finalTitle.match(/.*\s-\s(\d+).*/);
  if (!episodeMatch) {
    throw new Error('Invalid episode format');
  }
  let episodeNumber;
  episodeNumber = episodeMatch[1];

  return [title, episodeNumber];
}

/**
 * Extract the title and episode number from a ToonsHub title
 * @param {string} finalTitle - The final title
 * @param {string} fullTitle - The full title
 * @returns {string[]} - An array containing the extracted title and episode number
 */
function extractToonsHubTitleAndEpisode(finalTitle, fullTitle) {
  // Example: "[ToonsHub] YAIBA Samurai Legend S01E03 1080p B-Global WEB-DL AAC2.0 H.265 (Shin Samurai-den YAIBA, Multi-Subs)"

  // Remove the [ToonsHub] prefix
  const withoutPrefix = fullTitle.replace(/\[ToonsHub\]\s*/, '').trim();

  // Extract the title part (before the season/episode info)
  const titleMatch = withoutPrefix.match(/^(.+?)\s+S\d+E(\d+)/);
  if (!titleMatch) {
    throw new Error('Invalid ToonsHub title format');
  }

  const title = titleMatch[1].trim();
  const episodeNumber = titleMatch[2];

  return [title, episodeNumber];
}

/**
 * Load the whitelist from the whitelist JSON file
 * @returns {Object[]} - The whitelist array with title and group information
 */
function loadWhitelist() {
  if (fs.existsSync(FILE_PATHS.WHITELIST_FILE)) {
    try {
      const content = fs.readFileSync(FILE_PATHS.WHITELIST_FILE, 'utf8');
      const config = JSON.parse(content);
      console.info(`${COLORS.GRAY}[INFO] Loaded allowed titles from whitelist.json.${COLORS.RESET}`);
      return config.whitelist || [];
    } catch (error) {
      console.error(`${COLORS.RED}[ERROR] Failed to parse whitelist.json: ${error.message}${COLORS.RESET}`);
      return [];
    }
  }
  console.error(`${COLORS.RED}Failed to load whitelist or whitelist.json file not found.${COLORS.RESET}`);
  return [];
}



/**
 * Load the SubsPlease season mapping configuration
 * @returns {Object} - The season mapping configuration object
 */
function loadSubsPleasSeasonMapping() {
  if (fs.existsSync(FILE_PATHS.SUBSPLEASE_SEASON_MAPPING_FILE)) {
    try {
      const content = fs.readFileSync(FILE_PATHS.SUBSPLEASE_SEASON_MAPPING_FILE, 'utf8');
      const config = JSON.parse(content);
      console.info(`${COLORS.GRAY}[INFO] Loaded SubsPlease season mapping configuration.${COLORS.RESET}`);
      return config.mappings || {};
    } catch (error) {
      console.error(`${COLORS.RED}[ERROR] Failed to parse SubsPlease season mapping configuration: ${error.message}${COLORS.RESET}`);
      return {};
    }
  }
  console.info(`${COLORS.GRAY}[INFO] SubsPlease season mapping file not found. No season mapping will be applied.${COLORS.RESET}`);
  return {};
}

/**
 * Apply SubsPlease season mapping to a title based on episode number
 * @param {string} originalTitle - The original SubsPlease title (e.g., "[SubsPlease] Sono Bisque Doll wa Koi wo Suru - 13 (1080p) [6AF9A58D].mkv")
 * @param {Object} seasonMapping - The season mapping configuration
 * @returns {string} - The modified title with season information if applicable
 */
function applySubsPleasSeasonMapping(originalTitle, seasonMapping) {
  // Try multiple patterns to match SubsPlease format
  let subspleaseMatch = originalTitle.match(/\[SubsPlease\]\s(.+?)\s-\s(\d+)\s\((\d+p)\)\s\[([A-F0-9]+)\]\.mkv/);

  // If the first pattern doesn't match, try a more flexible pattern
  if (!subspleaseMatch) {
    subspleaseMatch = originalTitle.match(/\[SubsPlease\]\s(.+?)\s-\s(\d+)\s\((\d+p)\)\s\[([A-F0-9]+)\]/);
  }

  // Try pattern without file extension
  if (!subspleaseMatch) {
    subspleaseMatch = originalTitle.match(/\[SubsPlease\]\s(.+?)\s-\s(\d+)\s\((\d+p)\)/);
  }

  if (!subspleaseMatch) {
    console.info(`${COLORS.YELLOW}[WARNING] Could not parse SubsPlease title format: ${originalTitle}${COLORS.RESET}`);
    return originalTitle; // Return original if format doesn't match
  }

  const animeTitle = subspleaseMatch[1];
  const episodeNumber = parseInt(subspleaseMatch[2], 10);
  const quality = subspleaseMatch[3];
  const hash = subspleaseMatch[4] || '';

  // Check if this anime has season mapping configured
  if (seasonMapping[animeTitle] && episodeNumber >= seasonMapping[animeTitle].startEpisode) {
    const newTitle = seasonMapping[animeTitle].seasonTitle;

    // Always adjust episode numbers to start from 01 for the new season
    const newEpisodeNumber = episodeNumber - seasonMapping[animeTitle].startEpisode + 1;
    const formattedEpisodeNumber = newEpisodeNumber.toString().padStart(2, '0');

    let modifiedTitle;

    if (hash) {
      // Replace both title and episode number in the original format
      modifiedTitle = originalTitle
        .replace(animeTitle, newTitle)
        .replace(` - ${episodeNumber} `, ` - ${formattedEpisodeNumber} `);
    } else {
      modifiedTitle = `[SubsPlease] ${newTitle} - ${formattedEpisodeNumber} (${quality})`;
      if (originalTitle.includes('.mkv')) {
        modifiedTitle += '.mkv';
      }
    }

    console.info(`${COLORS.CYAN}[INFO] Applied season mapping: "${animeTitle}" -> "${newTitle}" for episode ${episodeNumber} (adjusted to ${formattedEpisodeNumber})${COLORS.RESET}`);
    return modifiedTitle;
  }

  return originalTitle; // Return original if no mapping applies
}

/**
 * Load the processed data from the processed titles and IDs files
 * @returns {string[][]} - An array containing the processed titles and processed IDs
 */
function loadProcessedData() {
  const processedTitles = fs.readFileSync(FILE_PATHS.PROCESSED_TITLES_FILE, 'utf8').split('\n');
  const processedIDs = fs.readFileSync(FILE_PATHS.PROCESSED_IDS_FILE, 'utf8').split('\n');
  return [processedTitles, processedIDs];
}

/**
 * Update the last processed ID
 * Sort array of all processed IDs and pick the highest one, and write it to a file
 * @returns {void}
 */
function updateLastProcessedID() {
  const data = fs.readFileSync(FILE_PATHS.PROCESSED_IDS_FILE, 'utf8');
  const ids = data.trim().split('\n').map(Number);
  ids.sort((a, b) => b - a);
  const lastID = ids[0];
  fs.writeFileSync(FILE_PATHS.LAST_ID_FILE, lastID.toString());
}

/**
 * Fetch the RSS feed
 * @param {string} url - The URL of the RSS feed
 * @returns {Promise<Object>} - The parsed RSS feed object
 * @throws {Error} - If the fetch fails after the maximum number of attempts
 */
async function fetchRSS(url) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await axios.get(url);
      return await parseStringPromise(response.data);
    } catch (error) {
      console.error(
        `${COLORS.RED}[ERROR] Attempt ${attempt + 1}: Failed to fetch RSS feed: ${error.message}${COLORS.RESET}`
      );
      if (attempt === MAX_ATTEMPTS - 1) {
        console.error(`${COLORS.RED}[ERROR] Giving up after ${MAX_ATTEMPTS} attempts${COLORS.RESET}`);
        throw new Error(`Failed after ${MAX_ATTEMPTS} attempts: ${error.message}`);
      }
      await sleep(SLEEP_DURATION);
    }
  }
}

/**
 * Check if an ID is already processed
 * @param {number} id - The ID to check
 * @param {string[]} processedIDs - The array of processed IDs
 * @returns {boolean} - True if the ID is already processed, false otherwise
 */
function isIDProcessed(id, processedIDs) {
  return processedIDs.includes(String(id));
}

/**
 * Stop the script from running when fired by cron.schedule
 * @returns {void}
 */
function stopRunning() {
  fs.writeFileSync(FILE_PATHS.IS_RUNNING_FILE, 'false');
}

/**
 * Extract the filename from the full title
 * @param {string} filename - The full title
 * @returns {string | null} - The extracted filename or null if not found
 */
function extractFilename(filename) {
  // Check if this is a ToonsHub title
  if (filename.includes('[ToonsHub]')) {
    return extractToonsHubFilename(filename);
  }

  // Store original format info for better handling
  const isOriginalSubsPlease = filename.includes('[SubsPlease]');
  const isOriginalNewRaws = filename.includes('[New-raws]');

  // Normalize SubsPlease and New-raws to Erai-raws format for processing
  filename = filename.replace('[SubsPlease]', '[Erai-raws]').replace('(1080p)', '[1080p]');
  filename = filename.replace('[New-raws]', '[Erai-raws]');

  /**
   * Replaces all occurrences of "v2" or "v3" (case-insensitive) in the `filename` string with an empty string.
   * @type {string}
   */
  filename = filename.replace(/v[23]/gi, '');

  /**
  * The pattern assumes the filename starts with "[Erai-raws]", followed by any characters,
  * followed by "- <digits>", optionally followed by "(JA)" language tag only,
  * and any bracketed section containing "1080p".
  * For SubsPlease and New-raws, we also accept more lenient patterns.
  * @type {RegExpMatchArray|null}
  */
  let match = filename.match(/^\[Erai-raws\].*- \d+(?:\s*\(JA\))?\s*\[.*1080p.*\]/);

  // If no match and this was originally SubsPlease, try a more lenient pattern
  if (!match && isOriginalSubsPlease) {
    match = filename.match(/^\[Erai-raws\].*- \d+.*\[1080p\]/);
  }

  // If no match and this was originally New-raws, try a more lenient pattern
  if (!match && isOriginalNewRaws) {
    match = filename.match(/^\[Erai-raws\].*- \d+.*\[1080p\]/);
  }

  return match ? match[0] : null;
}

/**
 * Extract the filename from a ToonsHub title
 * @param {string} filename - The full ToonsHub title
 * @returns {string | null} - The extracted filename or null if not found
 */
function extractToonsHubFilename(filename) {
  // Example: "[ToonsHub] YAIBA Samurai Legend S01E03 1080p B-Global WEB-DL AAC2.0 H.265 (Shin Samurai-den YAIBA, Multi-Subs)"

  // Check if it's a ToonsHub title with 1080p
  if (filename.includes('[ToonsHub]') && filename.includes('1080p')) {
    // Skip H.265 releases
    if (filename.includes('H.265')) {
      console.info(`${COLORS.GRAY}[INFO] Skipping ToonsHub H.265 release: ${filename}${COLORS.RESET}`);
      return null;
    }
    // Skip releases that don't contain "CR"
    if (!filename.toLowerCase().includes('cr') || !filename.toLowerCase().includes('hidive') || !filename.toLowerCase().includes('amzn')) {
      console.info(`${COLORS.GRAY}[INFO] Skipping ToonsHub release without CR: ${filename}${COLORS.RESET}`);
      return null;
    }
    return filename;
  }

  return null;
}

/**
 * Extract the whitelist filename from the full title
 * @param {string} filename - The full title
 * @returns {string | null} - The extracted whitelist filename or null if not found
 */
function extractWhitelistFilename(filename) {
  // Check if this is a ToonsHub title
  if (filename.includes('[ToonsHub]')) {
    return extractToonsHubWhitelistFilename(filename);
  }

  /**
   * The pattern matches any of the following:
   * - A string starting with "[" and ending with "]" at the beginning of the string.
   * - A hyphen followed by optional spaces and one or more digits.
   * - A string enclosed in parentheses.
   */
  const pattern = /(?:^\[.*?\]\s*|\(.*?\))/g;
  const cleaned = filename.replace(pattern, '').trim();
  /**
   * The pattern matches any characters until it encounters either a space followed by "["
   * or a space followed by ".mkv".
   */
  const titlePattern = /(.+?)\s-\s\d{2}/;
  return cleaned.match(titlePattern)?.[1].trim() ?? null;
}

/**
 * Extract the whitelist filename from a ToonsHub title
 * @param {string} filename - The full ToonsHub title
 * @returns {string | null} - The extracted whitelist filename or null if not found
 */
function extractToonsHubWhitelistFilename(filename) {
  // Example: "[ToonsHub] YAIBA Samurai Legend S01E03 1080p B-Global WEB-DL AAC2.0 H.265 (Shin Samurai-den YAIBA, Multi-Subs)"
  // We want to extract: "YAIBA Samurai Legend"

  // Remove the [ToonsHub] prefix
  const withoutPrefix = filename.replace(/\[ToonsHub\]\s*/, '').trim();

  // Extract the title part (before the season/episode info)
  const titleMatch = withoutPrefix.match(/^(.+?)\s+S\d+E\d+/);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }

  return null;
}

/**
 * Check if a title is whitelisted and matches group preferences
 * @param {string} title - The title to check
 * @param {Object[]} whitelist - The whitelist array with title and group information
 * @param {string} releaseGroup - The release group (Erai-raws, SubsPlease, New-raws, ToonsHub)
 * @returns {boolean} - True if the title is whitelisted and group matches, false otherwise
 */
function isWhitelisted(title, whitelist, releaseGroup = '') {
  const whitelistEntry = whitelist.find((item) =>
    title.trim().toLowerCase() === item.title.trim().toLowerCase()
  );

  if (!whitelistEntry) {
    return false;
  }

  // If group is "any", accept any release group
  if (whitelistEntry.group === 'any') {
    return true;
  }

  // Check if the release group matches the preferred group
  return whitelistEntry.group === releaseGroup;
}

/**
 * Normalize a title to a common format for duplicate detection between SubsPlease, Erai-raws, New-raws, and ToonsHub
 * @param {string} title - The title to normalize
 * @returns {string} - The normalized title
 */
function normalizeTitle(title) {
  // Convert all sources to a common format for comparison
  let normalized = title.trim().toLowerCase();

  // Handle ToonsHub format first (e.g., "[ToonsHub] YAIBA Samurai Legend S01E03 1080p...")
  if (normalized.includes('[toonshub]')) {
    // Extract title and episode from ToonsHub format
    const toonsHubMatch = normalized.match(/\[toonshub\]\s*(.+?)\s+s\d+e(\d+)/);
    if (toonsHubMatch) {
      const animeTitle = toonsHubMatch[1].trim();
      const episodeNumber = parseInt(toonsHubMatch[2], 10);
      // Convert to standard format: "title - episode"
      normalized = `${animeTitle} - ${episodeNumber}`;
    }
  } else {
    // Remove release group tags for other sources
    normalized = normalized.replace(/\[subsplease\]/g, '').replace(/\[erai-raws\]/g, '').replace(/\[new-raws\]/g, '');

    // Remove all bracketed content (quality, hashes, metadata, etc.)
    normalized = normalized.replace(/\[.*?\]/g, '');
    normalized = normalized.replace(/\(.*?\)/g, '');

    // Remove file extensions
    normalized = normalized.replace(/\.(mkv|mp4|avi)$/g, '');

    // Normalize episode number format (ensure consistent spacing around dash)
    normalized = normalized.replace(/\s*-\s*(\d+)/g, ' - $1');
  }

  // Remove extra spaces and normalize spacing
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Additional normalization for better matching
  // Remove common variations in punctuation and spacing
  normalized = normalized.replace(/[._]/g, ' '); // Convert dots and underscores to spaces
  normalized = normalized.replace(/\s+/g, ' ').trim(); // Normalize multiple spaces

  // Normalize episode numbers to ensure consistent format (pad single digits)
  normalized = normalized.replace(/\s-\s(\d)\b/g, ' - 0$1');

  return normalized;
}

/**
 * Check if a title is already processed, considering SubsPlease/Erai-raws/New-raws/ToonsHub equivalence
 * Only checks against completed downloads, not queued or currently downloading items
 * @param {string} title - The title to check
 * @param {string[]} processedTitles - The array of processed titles
 * @returns {boolean} - True if the title is already processed, false otherwise
 */
function isTitleProcessed(title, processedTitles) {
  const normalizedTitle = normalizeTitle(title);

  const isDuplicate = processedTitles.some((processedTitle) => {
    const normalizedProcessed = normalizeTitle(processedTitle);
    const isMatch = normalizedTitle === normalizedProcessed;

    // Debug logging for duplicate detection
    if (isMatch) {
      console.info(`${COLORS.YELLOW}[DEBUG] Duplicate detected:${COLORS.RESET}`);
      console.info(`${COLORS.YELLOW}[DEBUG]   New: "${title}" -> "${normalizedTitle}"${COLORS.RESET}`);
      console.info(`${COLORS.YELLOW}[DEBUG]   Existing: "${processedTitle}" -> "${normalizedProcessed}"${COLORS.RESET}`);
    }

    return isMatch;
  });

  return isDuplicate;
}

/**
 * Send debug information to a Discord webhook on a dev server
 * @param {string} content - The content to send
 * @returns {Promise<void>}
 */
async function sendDebugInfoToDiscord(content) {
  try {
    const webhookURL = process.env.DEV_DISCORD_WEBHOOK;
    if (!webhookURL) {
      console.error('Discord webhook URL is not defined in the environment variables.');
      return;
    }
    const payload = { content };
    const response = await axios.post(webhookURL, payload);
    if (response.status !== 204) {
      console.error('Failed to send Discord webhook. Status code:', response.status);
    }
  } catch (error) {
    console.error('Error sending Discord webhook:', error);
  }
}

/**
 * Log the release time in Japan
 * currently ununsed - maybe used later to show the time from japanese release in the footer of a discord message
 * @param {string} timestamp - The release timestamp
 * @param {string} title - The title of the anime
 * @param {string} episodeNumber - The episode number
 * @returns {void}
 */
// @ts-ignore
function logReleaseTimeJapan(timestamp, title, episodeNumber) {
  const data = { startTime: timestamp };
  const jsonData = JSON.stringify(data, null, 2);
  fs.writeFileSync(`D:/Projekty/lycoris.cafe - discord/timeInfo/${title} - ${episodeNumber}.json`, jsonData);
}

/**
 * Format bytes into a human-readable string
 * @param {number} bytes - The number of bytes
 * @returns {string} - The formatted bytes string
 */
function formatBytes(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Add double brackets to the filename if missing
 * @param {string} filename - The filename
 * @returns {string} - The filename with double brackets
 */
function addDoubleBracketsToFilename(filename) {
  return hasDoubleBrackets(filename) ? filename : `${filename}[1080p]`;
}

/**
 * Check if a filename has double brackets
 * @param {string} filename - The filename
 * @returns {boolean} - True if the filename has double brackets, false otherwise
 */
function hasDoubleBrackets(filename) {
  /**
   * Matches and returns an array of all occurrences of "[" in the `filename` string.
   * @type {RegExpMatchArray|null}
   */
  return (filename.match(/\[/g) || []).length >= 2;
}

/**
 * Create a directory if it doesn't exist
 * @param {string} directory - The directory path
 * @returns {void}
 */
function createDirectoryIfNotExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }
}

/**
 * Create a write stream for a file
 * @param {string} filePath - The file path
 * @returns {fs.WriteStream} - The write stream
 */
function createWriteStream(filePath) {
  return fs.createWriteStream(filePath, { flags: 'a' });
}

/**
 * Override the console.log function to log to a file
 * @param {fs.WriteStream} logStream - The write stream for the log file
 * @returns {void}
 */
function overrideConsoleLog(logStream) {
  const originalLog = console.info;
  console.info = (...args) => {
    const timestamp = getTimestamp();
    const logMessage = `[${timestamp}] ${args.join(' ')}\n`;
    originalLog(...args);
    logStream.write(logMessage);
  };
}

/**
 * Override the console.error function to log to a file
 * @param {fs.WriteStream} errorStream - The write stream for the error file
 * @returns {void}
 */
function overrideConsoleError(errorStream) {
  const originalError = console.error;
  console.error = (...args) => {
    const timestamp = getTimestamp();
    const errorMessage = cleanErrorMessage(`[${timestamp}] ${args.join(' ')}\n`);
    originalError(...args);
    errorStream.write(errorMessage);
  };
}

/**
 * Handle an uncaught exception
 * Send info to discord about an uncaught exception
 * @param {Error} err - The error object
 * @returns {Promise<void>}
 */
async function handleUncaughtException(err) {
  const errorMessage = cleanErrorMessage(err.toString());
  await sendDebugInfoToDiscord(`\`[ERROR]\` <@351006685587963916> \`\`\`${errorMessage}\n${err.stack}\`\`\``);
  const timestamp = getTimestamp();
  const exceptionMessage = `[${timestamp}] ${err.stack}\n`;
  console.error(exceptionMessage);
  exceptionLogStream.write(exceptionMessage);
  process.exit(1);
}

/**
 * Handle an unhandled rejection
 * Send info to discord about an unhandled rejection
 * @param {*} reason - The reason for the rejection
 * @param {Promise} promise - The rejected promise
 * @returns {Promise<void>}
 */
// @ts-ignore
async function handleUnhandledRejection(reason, promise) {
  const reasonMessage = cleanErrorMessage(reason.toString());
  await sendDebugInfoToDiscord(`\`[ERROR]\` <@351006685587963916> \`\`\`${reasonMessage}\n${reason.stack}\`\`\``);
  const timestamp = getTimestamp();
  const rejectionMessage = `[${timestamp}]\n${reason.stack}\n`;
  console.error(rejectionMessage);
  rejectionLogStream.write(rejectionMessage);
  process.exit(1);
}

/**
 * Handle a graceful shutdown
 * @returns {void}
 */
function handleGracefulShutdown() {
  stopRunning();
  const timestamp = getTimestamp();
  const shutdownMessage = `[${timestamp}] Graceful shutdown\n`;
  console.info(shutdownMessage);
  infoLogStream.write(shutdownMessage);
  infoLogStream.end();
  errorLogStream.end();
  exceptionLogStream.end();
  rejectionLogStream.end(() => {
    process.exit(0);
  });
}

/**
 * Sleep for a specified duration
 * @param {number} ms - The duration in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the current timestamp
 * @returns {string} - The current timestamp in ISO format
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Clean an error message by removing ANSI color codes and unwanted characters
 * @param {string} errorMessage - The error message
 * @returns {string} - The cleaned error message
 */
function cleanErrorMessage(errorMessage) {
  // @ts-ignore
  return errorMessage.replaceAll(/\[90m|\[36m|\[37m|\[46m|\[30m|\[0m|\[31m|\[33m/g, '').replaceAll('', '');
}

/**
 * Set up error handling for uncaught exceptions and unhandled rejections
 * @returns {void}
 */
function setupUncaughtErrorHandling() {
  process.on('uncaughtException', handleUncaughtException);
  process.on('unhandledRejection', handleUnhandledRejection);
  process.on('SIGINT', handleGracefulShutdown);
}

/**
 * Set up logging by overriding console.log and console.error
 * @returns {void}
 */
function setupLogging() {
  overrideConsoleLog(infoLogStream);
  overrideConsoleError(errorLogStream);
}

/**
 * Start the clearing process
 * @returns {void}
 * @throws {Error} - If an error occurs during the clearing process
 */
function startClearingProcess() {
  try {
    console.info(`${COLORS.BG_CYAN}${COLORS.BLACK}[INFO] Starting clearing process...${COLORS.RESET}`);
    cp.execSync('node app/1clear/clear.js', { stdio: 'inherit' });
    console.info(`${COLORS.BG_CYAN}${COLORS.BLACK}[INFO] Clearing process completed successfully.${COLORS.RESET}`);
  } catch (error) {
    console.error(`${COLORS.RED}[ERROR] Error in clearing process: ${error.message}${COLORS.RESET}`);
    throw error;
  }
}
