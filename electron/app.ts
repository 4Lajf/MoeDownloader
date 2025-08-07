import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } from "electron";
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
  processedFilesOperations,
  activityLogsOperations,
  processedGuidsOperations
} from "./lib/database";
import { createAppService } from "./services/app-service";
import { createDownloadManager } from "./services/download-manager";
import { createRSSProcessor } from "./services/rss-processor";
import { createNotificationService } from "./services/notification-service";
import { createAniListService } from "./services/anilist-service";
import { createAnimeRelationsManager } from "./services/anime-relations";
import { createAniListSyncService } from "./services/anilist-sync";
import { createActivityLogger } from "./services/activity-logger";

let mainWindow: BrowserWindow;
let loaderWindow: BrowserWindow;
let tray: Tray | null = null;
let appService: any;
let downloadManager: any;
let rssProcessor: any;
let notificationService: any;
let anilistService: any;
let animeRelationsManager: any;
let anilistSyncService: any;
let activityLogger: any;
let sharedTitleOverridesManager: any;

// Set app name for notifications and system integration
app.setName('MoeDownloader');

app.once("ready", () => {
  // Create and show loader window immediately
  createLoaderWindow();

  // Start main initialization process
  main();
});

function createLoaderWindow() {
  loaderWindow = new BrowserWindow({
    width: 250,
    height: 250,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    minimizable: true,
    maximizable: false,
    closable: true, // Allow programmatic closing
    skipTaskbar: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the loader HTML file
  loaderWindow.loadFile(join(__dirname, "loader.html"));

  loaderWindow.once('ready-to-show', () => {
    loaderWindow.show();
    loaderWindow.center();
  });

  loaderWindow.on('closed', () => {
    loaderWindow = null;
  });
}

async function main() {
  // Initialize database first
  try {
    updateLoaderProgress('Initializing database...', 10);
    await initDatabase();
    // Database logs its own initialization message
  } catch (error) {
    console.error('Failed to initialize database:', error);

    // Close loader window on error
    if (loaderWindow && !loaderWindow.isDestroyed()) {
      loaderWindow.close();
    }

    app.quit();
    return;
  }

  // Initialize services
  updateLoaderProgress('Creating services...', 20);
  activityLogger = createActivityLogger();
  notificationService = createNotificationService();
  anilistService = createAniListService();
  animeRelationsManager = createAnimeRelationsManager();
  downloadManager = createDownloadManager(notificationService);

  // Create title overrides manager early so it can be shared
  const { createTitleOverridesManager } = require('./services/title-overrides');
  sharedTitleOverridesManager = createTitleOverridesManager();

  // Create RSS processor with shared instances
  rssProcessor = createRSSProcessor(notificationService, anilistService, activityLogger, animeRelationsManager, sharedTitleOverridesManager);

  // Initialize RSS processor
  updateLoaderProgress('Setting up RSS processor...', 35);
  await rssProcessor.initialize();
  // RSS processor logs its own initialization message

  // Initialize app service with shared instances
  updateLoaderProgress('Initializing app service...', 50);
  appService = createAppService(rssProcessor, downloadManager, activityLogger, sharedTitleOverridesManager);
  await appService.initialize();
  console.log('🔄 App service initialized');

  // Log RSS processing configuration
  const rssUrl = configOperations.get('rss_feed_url');
  const rssInterval = configOperations.get('rss_check_interval') || 30;
  console.log(`📡 RSS: Feed URL: ${rssUrl || 'Not configured'}`);
  console.log(`⏰ RSS: Check interval: ${rssInterval} minutes`);

  // Initialize AniList services
  updateLoaderProgress('Configuring AniList...', 65);
  try {
    await anilistService.initialize();
    await animeRelationsManager.initialize();

    // Initialize sync service with shared AniList service
    anilistSyncService = createAniListSyncService(notificationService, anilistService);
    await anilistSyncService.initialize();
  } catch (error) {
    console.error('Failed to initialize AniList services:', error);
  }

  // Initialize title overrides manager (after database is ready)
  updateLoaderProgress('Loading title overrides...', 80);
  try {
    await sharedTitleOverridesManager.initialize();

    const userOverridesData = sharedTitleOverridesManager.getUserOverridesData();
    console.log('🔍 MAIN APP STARTUP: User title overrides status:');
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
  } catch (error) {
    console.error('❌ Failed to initialize main app title overrides manager:', error);
  }

  updateLoaderProgress('Creating main window...', 90);

  // Create app icon
  const iconPath = join(__dirname, "assets", "icon.png");
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "MoeDownloader",
    icon: appIcon,
    resizable: true,
    show: false,
    frame: false, // Remove default titlebar
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000', // Transparent background
    webPreferences: {
      devTools: !app.isPackaged,
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

      // Close loader window on error
      if (loaderWindow && !loaderWindow.isDestroyed()) {
        loaderWindow.close();
      }

      // Show window anyway so user can see the error
      mainWindow.show();
      return;
    }
  }

  // Set up notification service with main window
  notificationService.setMainWindow(mainWindow);

  // Create system tray
  createTray();

  // Handle window close event (hide to tray instead of closing)
  mainWindow.on('close', (event) => {
    const hideToTray = configOperations.get('hide_to_tray_on_close');
    if (hideToTray === 'true' || hideToTray === true) {
      event.preventDefault();
      mainWindow.hide();

      // Show notification about hiding to tray (only once per session)
      if (!global.hasShownTrayNotification) {
        notificationService.sendOSNotification(
          'MoeDownloader',
          'Application was minimized to tray. Click the tray icon to restore.',
          {
            onClick: () => {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        );
        global.hasShownTrayNotification = true;
      }
    }
  });

  // Show window immediately when ready to display loading screen
  mainWindow.once("ready-to-show", () => {
    console.log('Window ready to show - displaying main window');
    updateLoaderProgress('Ready!', 100);

    // Show main window after a brief delay to let progress complete
    setTimeout(() => {
      const startMinimized = configOperations.get('start_minimized_to_tray');
      if (startMinimized === 'true' || startMinimized === true) {
        // Don't show the window if starting minimized
        console.log('Starting minimized to tray');
      } else {
        mainWindow.show();
      }
      // Note: Loader window will be closed by the Svelte app when it's fully ready
    }, 500);
  });

  // Also show on did-finish-load as a backup
  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow.isVisible()) {
      console.log('Page loaded - showing window with loading screen');
      mainWindow.show();

      // Close loader window if it's still open
      setTimeout(() => {
        if (loaderWindow && !loaderWindow.isDestroyed()) {
          loaderWindow.close();
        }
      }, 500);
    }
  });
}

function createTray() {
  const iconPath = join(__dirname, "assets", "icon.png");
  const trayIcon = nativeImage.createFromPath(iconPath);

  // Resize icon for tray (16x16 or 32x32 depending on platform)
  const resizedIcon = trayIcon.resize({ width: 16, height: 16 });

  tray = new Tray(resizedIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show MoeDownloader',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Hide to Tray',
      click: () => {
        mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: 'RSS Monitoring',
      submenu: [
        {
          label: 'Start Monitoring',
          click: async () => {
            try {
              await appService.startRSSMonitoring();
              notificationService.sendOSNotification(
                'RSS Monitoring Started',
                'RSS feed monitoring is now active'
              );
            } catch (error) {
              console.error('Error starting RSS monitoring from tray:', error);
            }
          }
        },
        {
          label: 'Stop Monitoring',
          click: async () => {
            try {
              await appService.stopRSSMonitoring();
              notificationService.sendOSNotification(
                'RSS Monitoring Stopped',
                'RSS feed monitoring has been stopped'
              );
            } catch (error) {
              console.error('Error stopping RSS monitoring from tray:', error);
            }
          }
        },
        {
          label: 'Check Now',
          click: async () => {
            let checkingNotification = null;
            try {
              // Show persistent checking notification
              checkingNotification = notificationService.sendOSNotification(
                'RSS Check in Progress',
                'Checking RSS feed for new episodes...',
                { silent: true }
              );

              const result = await rssProcessor.processRSSFeed();

              // Close the checking notification
              if (checkingNotification) {
                checkingNotification.close();
              }

              // Show completion notification
              notificationService.sendOSNotification(
                'RSS Check Complete',
                `Found ${result?.newEntries || 0} new entries`
              );
            } catch (error) {
              console.error('Error processing RSS from tray:', error);

              // Close the checking notification
              if (checkingNotification) {
                checkingNotification.close();
              }

              // Show user-friendly error notification
              let errorMessage = 'Unknown error occurred';
              if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
                errorMessage = 'No internet connection available';
              } else if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
                errorMessage = 'Request timed out - server may be slow';
              } else if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Connection refused - server may be down';
              } else if (error.message) {
                errorMessage = error.message;
              }

              notificationService.sendOSNotification(
                'RSS Check Failed',
                errorMessage,
                { urgency: 'critical' }
              );
            }
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Quit MoeDownloader',
      click: () => {
        // Force quit the application
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('MoeDownloader - Anime Download Manager');

  // Double-click to show/hide window
  tray.on('double-click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// IPC Handlers
ipcMain.handle("get-version", (_, key: "electron" | "node") => {
  return String(process.versions[key]);
});

ipcMain.handle("get-app-version", () => {
  try {
    // Use Electron's app.getVersion() which reads from package.json
    return app.getVersion();
  } catch (error) {
    console.error('Error reading app version:', error);
    return '1.0.0';
  }
});

ipcMain.handle("is-app-packaged", () => {
  return app.isPackaged;
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

ipcMain.handle("window-hide-to-tray", () => {
  mainWindow?.hide();
});

ipcMain.handle("window-show-from-tray", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized() || false;
});

ipcMain.handle("window-show", () => {
  if (mainWindow && !mainWindow.isVisible()) {
    console.log('Renderer requested window show');
    mainWindow.show();
  }
});

ipcMain.handle("close-loader", () => {
  if (loaderWindow && !loaderWindow.isDestroyed()) {
    console.log('Renderer requested loader close - closing loader window');
    loaderWindow.close();
  } else {
    console.log('Loader window already closed or destroyed');
  }
});

// Function to update loader progress
function updateLoaderProgress(text: string, progress: number) {
  if (loaderWindow && !loaderWindow.isDestroyed()) {
    loaderWindow.webContents.executeJavaScript(`
      if (window.updateProgress) {
        window.updateProgress('${text}', ${progress});
      }
    `).catch(() => {
      // Ignore errors if loader is closing
    });
  }
}

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

ipcMain.handle("search-rss-feed", async (_, query) => {
  try {
    const result = await rssProcessor.searchFeed(query);
    return result;
  } catch (error) {
    console.error('💥 SEARCH: RSS search failed:', error);
    throw error;
  }
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

ipcMain.handle("pause-all-downloads", () => {
  return downloadManager.pauseAllDownloads();
});

ipcMain.handle("cleanup-torrents", () => {
  return downloadManager.cleanupOrphanedTorrents();
});

// Settings operations
ipcMain.handle("get-settings", () => {
  const config = configOperations.getAll();

  // Map database keys to UI keys
  const settingsMapping = {
    'rss_feed_url': 'rssUrl',
    'check_interval_minutes': 'checkInterval',
    'downloads_directory': 'downloadPath',
    'max_concurrent_downloads': 'maxConcurrentDownloads',
    'torrent_port': 'torrentPort',
    'enable_auto_start': 'enableAutoStart',
    'disabled_fansub_groups': 'disabledFansubGroups',
    'enable_os_notifications': 'enableNotifications',
    'notification_sound': 'notificationSound',
    'enable_notification_download-started': 'notifyDownloadStart',
    'enable_notification_download-completed': 'notifyDownloadComplete',
    'enable_notification_download-failed': 'notifyDownloadError',
    'enable_notification_rss-processed': 'notifyRSSNewItems',
    'enable_notification_rss-error': 'notifyRSSError',
    'anilist_access_token': 'anilistAccessToken',
    'anilist_username': 'anilistUsername',
    'anilist_user_id': 'anilistUserId',
    'hide_to_tray_on_close': 'hideToTrayOnClose',
    'start_minimized_to_tray': 'startMinimizedToTray',
    'show_advanced_tabs_in_sidebar': 'showAdvancedTabsInSidebar',
    'enable_dht': 'enableDHT',
    'enable_pex': 'enablePEX',
    'enable_lsd': 'enableLSD'
  };

  // Convert database config to UI settings format
  const uiSettings = {};
  for (const [dbKey, uiKey] of Object.entries(settingsMapping)) {
    if (config[dbKey] !== undefined) {
      let value = config[dbKey];
      // Convert string booleans to actual booleans
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      // Convert string numbers to actual numbers
      else if (!isNaN(value) && !isNaN(parseFloat(value))) value = parseFloat(value);

      uiSettings[uiKey] = value;
    }
  }

  return uiSettings;
});

ipcMain.handle("save-settings", (_, settings) => {
  // Map UI keys to database keys
  const settingsMapping = {
    'rssUrl': 'rss_feed_url',
    'checkInterval': 'check_interval_minutes',
    'downloadPath': 'downloads_directory',
    'maxConcurrentDownloads': 'max_concurrent_downloads',
    'torrentPort': 'torrent_port',
    'enableAutoStart': 'enable_auto_start',
    'disabledFansubGroups': 'disabled_fansub_groups',
    'enableNotifications': 'enable_os_notifications',
    'notificationSound': 'notification_sound',
    'notifyDownloadStart': 'enable_notification_download-started',
    'notifyDownloadComplete': 'enable_notification_download-completed',
    'notifyDownloadError': 'enable_notification_download-failed',
    'notifyRSSNewItems': 'enable_notification_rss-processed',
    'notifyRSSError': 'enable_notification_rss-error',
    'anilistAccessToken': 'anilist_access_token',
    'anilistUsername': 'anilist_username',
    'anilistUserId': 'anilist_user_id',
    'hideToTrayOnClose': 'hide_to_tray_on_close',
    'startMinimizedToTray': 'start_minimized_to_tray',
    'showAdvancedTabsInSidebar': 'show_advanced_tabs_in_sidebar',
    'enableDHT': 'enable_dht',
    'enablePEX': 'enable_pex',
    'enableLSD': 'enable_lsd'
  };

  const promises = Object.entries(settings).map(([uiKey, value]) => {
    const dbKey = settingsMapping[uiKey] || uiKey; // Use original key if no mapping found
    return configOperations.set(dbKey, String(value));
  });

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

// Test RSS feed with actual download functionality
ipcMain.handle("test-rss-download", async (_, url, options = {}) => {
  try {
    console.log('🧪 TEST: Starting RSS download test for:', url);
    console.log('🧪 TEST: Options:', options);

    const result = await rssProcessor.testRSSDownload(url, options);
    console.log('🧪 TEST: RSS download test completed:', JSON.stringify(result.summary || result, null, 2));

    // Log detailed results for easier debugging
    if (result.success && result.results) {
      result.results.forEach((r, index) => {
        console.log(`🧪 TEST: Download Result ${index + 1}:`);
        console.log(`  Original Title: ${r.originalTitle}`);
        console.log(`  Status: ${r.status}`);
        console.log(`  Downloaded: ${r.downloaded}`);
        console.log(`  Final Title: ${r.finalTitle || 'N/A'}`);
        console.log(`  Download ID: ${r.downloadId || 'N/A'}`);
        console.log(`  Match Found: ${r.matchResult?.entry ? 'Yes' : 'No'}`);
        if (r.matchResult?.entry) {
          console.log(`  Matched Whitelist Entry: ${r.matchResult.entry.title}`);
        }
        console.log(`  Error: ${r.error || 'None'}`);
        console.log('---');
      });
    }

    return result;
  } catch (error) {
    console.error('💥 TEST: RSS download test failed:', error);
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

ipcMain.handle("anilist-accounts-upsert", (_, account) => {
  return anilistAccountOperations.upsert(account);
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
  if (!anilistSyncService) {
    throw new Error('AniList sync service not initialized');
  }
  return await anilistSyncService.forceSyncAll();
});

ipcMain.handle("anilist-sync-get-status", () => {
  if (!anilistSyncService) {
    return { isRunning: false, hasPeriodicSync: false, intervalHours: 4 };
  }
  return anilistSyncService.getSyncStatus();
});

ipcMain.handle("anilist-sync-start-periodic", () => {
  if (!anilistSyncService) {
    throw new Error('AniList sync service not initialized');
  }
  return anilistSyncService.startPeriodicSync();
});

ipcMain.handle("anilist-sync-stop-periodic", () => {
  if (!anilistSyncService) {
    throw new Error('AniList sync service not initialized');
  }
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

// Activity logs operations
ipcMain.handle("get-activity-logs", (_, limit, type) => {
  return activityLogsOperations.getRecent(limit, type);
});

ipcMain.handle("clear-activity-logs", () => {
  return activityLogsOperations.clear();
});

// Processed GUIDs operations
ipcMain.handle("clear-processed-guids", () => {
  return processedGuidsOperations.clear();
});

ipcMain.handle("get-processed-guids-count", () => {
  const guids = processedGuidsOperations.getAll();
  return guids.length;
});

// Title overrides operations - use the shared instance created during initialization

ipcMain.handle("get-user-title-overrides", async () => {
  try {
    return sharedTitleOverridesManager.getUserOverridesData();
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

    // Reload user overrides in the shared manager
    await sharedTitleOverridesManager.loadUserOverrides();

    // Also reload user overrides in the RSS processor
    if (rssProcessor && rssProcessor.reloadUserOverrides) {
      const reloadResult = await rssProcessor.reloadUserOverrides();
      if (!reloadResult.success) {
        console.warn('⚠️  Failed to reload user overrides in RSS processor:', reloadResult.error);
      }
    }

    console.log('✅ User title overrides saved and reloaded in all managers');
    return { success: true };
  } catch (error) {
    console.error('Failed to save user title overrides:', error);
    throw error;
  }
});

ipcMain.handle("refresh-title-overrides", async () => {
  try {
    await sharedTitleOverridesManager.forceRefresh();
    return { success: true };
  } catch (error) {
    console.error('Failed to refresh title overrides:', error);
    throw error;
  }
});

// App cleanup handlers
app.on('before-quit', async () => {
  console.log('🧹 Cleaning up services before quit...');

  // Stop periodic refresh
  if (animeRelationsManager) {
    try {
      animeRelationsManager.cleanup();
    } catch (error) {
      console.error('Error cleaning up anime relations manager:', error);
    }
  }

  // Stop RSS monitoring
  if (appService) {
    try {
      appService.stopRSSMonitoring();
    } catch (error) {
      console.error('Error stopping RSS monitoring:', error);
    }
  }

  // Stop download manager
  if (downloadManager) {
    try {
      await downloadManager.shutdown();
    } catch (error) {
      console.error('Error shutting down download manager:', error);
    }
  }

  // Cleanup tray
  if (tray) {
    tray.destroy();
    tray = null;
  }

  console.log('✅ Cleanup completed');
});

app.on('window-all-closed', () => {
  // On Windows/Linux, keep the app running in the tray even when all windows are closed
  // Only quit if tray is not available or if explicitly requested
  const hideToTray = configOperations.get('hide_to_tray_on_close');
  if (process.platform !== 'darwin' && (!tray || hideToTray === 'false')) {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    main();
  }
});
