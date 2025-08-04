import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import electronReload from "electron-reload";
import { join } from "path";
import {
  initDatabase,
  whitelistOperations,
  downloadOperations,
  rssOperations,
  configOperations,
  anilistAccountOperations,
  anilistAutoListOperations,
  anilistAnimeCacheOperations,
  processedFilesOperations
} from "./lib/database";
import { createAppService } from "./services/app-service";
import { createDownloadManager } from "./services/download-manager";
import { createRSSProcessor } from "./services/rss-processor";
import { createNotificationService } from "./services/notification-service";
import { createAniListService } from "./services/anilist-service";
import { createAnimeRelationsManager } from "./services/anime-relations";
import { createAniListSyncService } from "./services/anilist-sync";

let mainWindow: BrowserWindow;
let appService: any;
let downloadManager: any;
let rssProcessor: any;
let notificationService: any;
let anilistService: any;
let animeRelationsManager: any;
let anilistSyncService: any;

app.once("ready", main);

async function main() {
  // Initialize database first
  try {
    await initDatabase();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    app.quit();
    return;
  }

  // Initialize services
  notificationService = createNotificationService();
  anilistService = createAniListService();
  animeRelationsManager = createAnimeRelationsManager();
  appService = createAppService();
  downloadManager = createDownloadManager(notificationService);
  rssProcessor = createRSSProcessor(notificationService, anilistService);

  // Initialize RSS processor
  await rssProcessor.initialize();
  console.log('🔄 RSS processor initialized');

  // Log RSS processing configuration
  const rssUrl = configOperations.get('rss_feed_url');
  const rssInterval = configOperations.get('rss_check_interval') || 30;
  console.log(`📡 RSS: Feed URL: ${rssUrl || 'Not configured'}`);
  console.log(`⏰ RSS: Check interval: ${rssInterval} minutes`);

  // Initialize AniList services
  try {
    await anilistService.initialize();
    await animeRelationsManager.initialize();

    // Initialize sync service
    anilistSyncService = createAniListSyncService(notificationService);
    await anilistSyncService.initialize();
  } catch (error) {
    console.error('Failed to initialize AniList services:', error);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "MoeDownloader",
    resizable: true,
    show: false,
    frame: false, // Remove default titlebar
    titleBarStyle: 'hidden',
    webPreferences: {
      // devTools: !app.isPackaged,
      devTools: true,
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Add error handling for loading
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load page:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully');
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  } else {
    // Watch both the compiled files and source files for hot-reloading
    electronReload(join(__dirname), {
      electron: app.getPath("exe"),
    });

    // Also watch the source files
    electronReload(join(__dirname, "../electron"), {
      electron: app.getPath("exe"),
      ignored: /node_modules|\.git/
    });

    try {
      await mainWindow.loadURL(`http://localhost:5173/`);
      console.log('Successfully loaded Vite dev server');
    } catch (error) {
      console.error('Failed to load Vite dev server:', error);
      // Show window anyway so user can see the error
      mainWindow.show();
      return;
    }
  }

  // Set up notification service with main window
  notificationService.setMainWindow(mainWindow);

  // Show window when ready, with fallback timeout
  mainWindow.once("ready-to-show", () => {
    console.log('Window ready to show');
    mainWindow.show();
  });

  // Fallback: show window after 3 seconds if ready-to-show doesn't fire
  setTimeout(() => {
    if (!mainWindow.isVisible()) {
      console.log('Window not visible after 3 seconds, forcing show');
      mainWindow.show();
    }
  }, 3000);
}

// IPC Handlers
ipcMain.handle("get-version", (_, key: "electron" | "node") => {
  return String(process.versions[key]);
});

// Window controls
ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window-close", () => {
  mainWindow?.close();
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized() || false;
});

// App initialization
ipcMain.handle("initialize-app", async () => {
  try {
    await appService.initialize();
    return { success: true };
  } catch (error) {
    console.error('App initialization failed:', error);
    throw error;
  }
});

// App status and stats
ipcMain.handle("get-app-status", () => {
  return appService.getStatus();
});

ipcMain.handle("get-stats", () => {
  return appService.getStats();
});

ipcMain.handle("get-recent-downloads", () => {
  return downloadOperations.getAll().slice(0, 5);
});

// RSS operations
ipcMain.handle("start-rss-monitoring", () => {
  return appService.startRSSMonitoring();
});

ipcMain.handle("stop-rss-monitoring", () => {
  return appService.stopRSSMonitoring();
});

ipcMain.handle("process-rss-feed", () => {
  return appService.processRSSFeed();
});

// Whitelist operations
ipcMain.handle("get-whitelist", () => {
  const entries = whitelistOperations.getAll();
  // Map backend field names to frontend field names
  return entries.map(entry => ({
    ...entry,
    group: entry.preferred_group || 'any'
  }));
});

ipcMain.handle("add-whitelist-entry", (_, entry) => {
  // Map frontend field names to backend field names
  const mappedEntry = {
    ...entry,
    preferred_group: entry.group || entry.preferred_group || 'any'
  };
  return whitelistOperations.add(mappedEntry);
});

ipcMain.handle("update-whitelist-entry", (_, id, entry) => {
  // Map frontend field names to backend field names
  const mappedEntry = {
    ...entry,
    preferred_group: entry.group || entry.preferred_group || 'any'
  };
  return whitelistOperations.update(id, mappedEntry);
});

ipcMain.handle("remove-whitelist-entry", (_, id) => {
  return whitelistOperations.delete(id);
});

ipcMain.handle("toggle-whitelist-entry", (_, id, enabled) => {
  return whitelistOperations.toggle(id, enabled);
});

// Download operations
ipcMain.handle("get-all-downloads", () => {
  return downloadOperations.getAll();
});

ipcMain.handle("remove-download", (_, id) => {
  return downloadManager.removeDownload(id);
});



ipcMain.handle("add-manual-download", (_, magnetLink, title) => {
  return downloadManager.addManualDownload(magnetLink, title);
});

ipcMain.handle("retry-download", (_, id) => {
  return downloadManager.retryDownload(id);
});

ipcMain.handle("pause-download", (_, id) => {
  return downloadManager.pauseDownload(id);
});

ipcMain.handle("resume-download", (_, id) => {
  return downloadManager.resumeDownload(id);
});

ipcMain.handle("cleanup-torrents", () => {
  return downloadManager.cleanupOrphanedTorrents();
});

// Settings operations
ipcMain.handle("get-settings", () => {
  return configOperations.getAll();
});

ipcMain.handle("save-settings", (_, settings) => {
  const promises = Object.entries(settings).map(([key, value]) =>
    configOperations.set(key, String(value))
  );
  return Promise.all(promises);
});

// File system operations
ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("open-folder", async (_, filePath) => {
  try {
    if (filePath) {
      // Show the file in the folder
      shell.showItemInFolder(filePath);
      return { success: true };
    } else {
      return { success: false, error: 'No file path provided' };
    }
  } catch (error) {
    console.error('Error opening folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-download-directory", () => {
  return downloadManager.getDownloadPath();
});

// RSS feed testing
ipcMain.handle("test-rss-feed", async (_, url) => {
  try {
    console.log('🧪 TEST: Starting RSS feed test for:', url);
    const result = await rssProcessor.testFeed(url);
    console.log('🧪 TEST: RSS feed test completed:', result);
    return result;
  } catch (error) {
    console.error('💥 TEST: RSS test failed:', error);
    throw error;
  }
});


// Test RSS feed with continuous numeration
ipcMain.handle("test-rss-continuous-numeration", async (_, url) => {
  try {
    console.log('🧪 TEST: Starting RSS continuous numeration test');
    const result = await rssProcessor.testRSSContinuousNumeration(url);
    console.log('🧪 TEST: RSS continuous numeration test completed:', JSON.stringify(result, null, 2));

    // Also log each result in detail for easier debugging
    if (result.success && result.results) {
      result.results.forEach((r, index) => {
        console.log(`🧪 TEST: Result ${index + 1}:`);
        console.log(`  Original Title: ${r.originalTitle}`);
        console.log(`  Parsed Data:`, JSON.stringify(r.parsedData, null, 4));
        console.log(`  Anime Relations Result:`, JSON.stringify(r.animeRelationsResult, null, 4));
        console.log(`  Error: ${r.error || 'None'}`);
        console.log('---');
      });
    }

    return result;
  } catch (error) {
    console.error('💥 TEST: RSS continuous numeration test failed:', error);
    throw error;
  }
});


// AniList operations
ipcMain.handle("anilist-get-auth-url", () => {
  return anilistService.getAuthUrl();
});

ipcMain.handle("anilist-store-token", async (_, token) => {
  return await anilistService.storeAccessToken(token);
});

ipcMain.handle("anilist-is-authenticated", () => {
  return anilistService.isAuthenticated();
});

ipcMain.handle("anilist-get-current-user", async () => {
  return await anilistService.getCurrentUser();
});

ipcMain.handle("anilist-get-user-anime-list", async (_, userId, status) => {
  return await anilistService.getUserAnimeList(userId, status);
});

ipcMain.handle("anilist-get-lists-by-status", async (_, statuses, userId) => {
  return await anilistService.getAnimeListsByStatus(statuses, userId);
});

ipcMain.handle("anilist-search-anime", async (_, search, page, perPage) => {
  return await anilistService.searchAnime(search, page, perPage);
});

ipcMain.handle("anilist-logout", () => {
  return anilistService.logout();
});

// AniList account operations
ipcMain.handle("anilist-accounts-get-all", () => {
  return anilistAccountOperations.getAll();
});

ipcMain.handle("anilist-accounts-get-active", () => {
  return anilistAccountOperations.getActive();
});

ipcMain.handle("anilist-accounts-set-active", (_, id) => {
  return anilistAccountOperations.setActive(id);
});

ipcMain.handle("anilist-accounts-delete", (_, id) => {
  return anilistAccountOperations.delete(id);
});

// AniList auto-download lists operations
ipcMain.handle("anilist-auto-lists-get-by-account", (_, accountId) => {
  return anilistAutoListOperations.getByAccountId(accountId);
});

ipcMain.handle("anilist-auto-lists-upsert", (_, config) => {
  return anilistAutoListOperations.upsert(config);
});

ipcMain.handle("anilist-auto-lists-get-enabled", () => {
  return anilistAutoListOperations.getEnabled();
});

ipcMain.handle("anilist-auto-lists-toggle", (_, id, enabled) => {
  return anilistAutoListOperations.toggle(id, enabled);
});

ipcMain.handle("anilist-auto-lists-delete", (_, id) => {
  return anilistAutoListOperations.delete(id);
});

// Anime relations operations
ipcMain.handle("anime-relations-get-episode-mapping", (_, anilistId, episodeNumber) => {
  return animeRelationsManager.getEpisodeMapping(anilistId, episodeNumber);
});

ipcMain.handle("anime-relations-force-refresh", async () => {
  return await animeRelationsManager.forceRefresh();
});

ipcMain.handle("anime-relations-get-data", () => {
  return animeRelationsManager.getRelationsData();
});

// AniList sync operations
ipcMain.handle("anilist-sync-force-all", async () => {
  return await anilistSyncService.forceSyncAll();
});

ipcMain.handle("anilist-sync-get-status", () => {
  return anilistSyncService.getSyncStatus();
});

ipcMain.handle("anilist-sync-start-periodic", () => {
  return anilistSyncService.startPeriodicSync();
});

ipcMain.handle("anilist-sync-stop-periodic", () => {
  return anilistSyncService.stopPeriodicSync();
});

// Config operations
ipcMain.handle("get-config", (_, key) => {
  return configOperations.get(key);
});

ipcMain.handle("set-config", (_, key, value) => {
  return configOperations.set(key, value);
});

ipcMain.handle("get-all-config", () => {
  return configOperations.getAll();
});

// External operations
ipcMain.handle("open-external", async (_, url) => {
  const { shell } = await import('electron');
  return shell.openExternal(url);
});

// Processed files operations
ipcMain.handle("get-processed-files", () => {
  return processedFilesOperations.getAll();
});

ipcMain.handle("delete-processed-file", (_, id) => {
  return processedFilesOperations.delete(id);
});

ipcMain.handle("clear-all-processed-files", () => {
  return processedFilesOperations.clear();
});

ipcMain.handle("clear-processed-files-by-whitelist-entry", (_, whitelistEntryId) => {
  return processedFilesOperations.deleteByWhitelistEntry(whitelistEntryId);
});

// Debug operations
ipcMain.handle("debug-processed-files", () => {
  try {
    const allFiles = processedFilesOperations.getAll();
    console.log(`🐛 DEBUG: Found ${allFiles.length} processed files in database`);
    allFiles.forEach((file, index) => {
      console.log(`🐛 DEBUG: File ${index + 1}:`, {
        id: file.id,
        whitelist_entry_id: file.whitelist_entry_id,
        anime_title: file.anime_title,
        episode_number: file.episode_number,
        final_title: file.final_title,
        processed_at: file.processed_at
      });
    });
    return allFiles;
  } catch (error) {
    console.error(`🐛 DEBUG: Error getting processed files:`, error);
    throw error;
  }
});

// Filename parsing operations
const { filenameParser } = require('./lib/filename-parser');

ipcMain.handle("parse-filename", (_, filename) => {
  try {
    return filenameParser.parse(filename);
  } catch (error) {
    console.error('Failed to parse filename:', error);
    throw error;
  }
});

ipcMain.handle("parse-multiple-filenames", (_, filenames) => {
  try {
    return filenameParser.parseMultiple(filenames);
  } catch (error) {
    console.error('Failed to parse multiple filenames:', error);
    throw error;
  }
});

// Title overrides operations
const { createTitleOverridesManager } = require('./services/title-overrides');
const titleOverridesManager = createTitleOverridesManager();

ipcMain.handle("get-user-title-overrides", async () => {
  try {
    return titleOverridesManager.getUserOverridesData();
  } catch (error) {
    console.error('Failed to get user title overrides:', error);
    throw error;
  }
});

ipcMain.handle("save-user-title-overrides", async (_, overrides) => {
  try {
    const fs = require('fs');
    const USER_OVERRIDES_FILE = 'user-title-overrides.json';

    // Write the overrides to the user file
    fs.writeFileSync(USER_OVERRIDES_FILE, JSON.stringify(overrides, null, 2), 'utf8');

    // Reload user overrides in the manager
    await titleOverridesManager.loadUserOverrides();

    return { success: true };
  } catch (error) {
    console.error('Failed to save user title overrides:', error);
    throw error;
  }
});

ipcMain.handle("refresh-title-overrides", async () => {
  try {
    await titleOverridesManager.forceRefresh();
    return { success: true };
  } catch (error) {
    console.error('Failed to refresh title overrides:', error);
    throw error;
  }
});

// App cleanup handlers
app.on('before-quit', () => {
  console.log('🧹 Cleaning up services before quit...');

  // Stop periodic refresh
  if (animeRelationsManager) {
    animeRelationsManager.cleanup();
  }

  // Stop RSS monitoring
  if (rssProcessor) {
    rssProcessor.stopMonitoring();
  }

  // Stop download manager
  if (downloadManager) {
    downloadManager.cleanup();
  }

  console.log('✅ Cleanup completed');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    main();
  }
});
