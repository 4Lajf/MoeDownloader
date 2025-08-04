import { contextBridge, ipcRenderer } from "electron";

export const CONTEXT_BRIDGE = {
  /**
   * Returns the version from process.versions of the supplied target.
   */
  getVersion: async (opt: "electron" | "node"): Promise<string> => {
    return await ipcRenderer.invoke(`get-version`, opt);
  },

  // Window controls
  windowMinimize: async (): Promise<void> => {
    return await ipcRenderer.invoke('window-minimize');
  },

  windowMaximize: async (): Promise<void> => {
    return await ipcRenderer.invoke('window-maximize');
  },

  windowClose: async (): Promise<void> => {
    return await ipcRenderer.invoke('window-close');
  },

  windowIsMaximized: async (): Promise<boolean> => {
    return await ipcRenderer.invoke('window-is-maximized');
  },

  // App initialization and status
  initializeApp: async (): Promise<any> => {
    return await ipcRenderer.invoke('initialize-app');
  },

  getAppStatus: async (): Promise<any> => {
    return await ipcRenderer.invoke('get-app-status');
  },

  getStats: async (): Promise<any> => {
    return await ipcRenderer.invoke('get-stats');
  },

  getRecentDownloads: async (): Promise<any[]> => {
    return await ipcRenderer.invoke('get-recent-downloads');
  },

  // RSS operations
  startRSSMonitoring: async (): Promise<void> => {
    return await ipcRenderer.invoke('start-rss-monitoring');
  },

  stopRSSMonitoring: async (): Promise<void> => {
    return await ipcRenderer.invoke('stop-rss-monitoring');
  },

  processRSSFeed: async (): Promise<void> => {
    return await ipcRenderer.invoke('process-rss-feed');
  },

  // Whitelist operations
  getWhitelist: async (): Promise<any[]> => {
    return await ipcRenderer.invoke('get-whitelist');
  },

  addWhitelistEntry: async (entry: any): Promise<any> => {
    return await ipcRenderer.invoke('add-whitelist-entry', entry);
  },

  updateWhitelistEntry: async (id: number, entry: any): Promise<any> => {
    return await ipcRenderer.invoke('update-whitelist-entry', id, entry);
  },

  removeWhitelistEntry: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('remove-whitelist-entry', id);
  },

  toggleWhitelistEntry: async (id: number, enabled: boolean): Promise<any> => {
    return await ipcRenderer.invoke('toggle-whitelist-entry', id, enabled);
  },

  // Download operations
  getAllDownloads: async (): Promise<any[]> => {
    return await ipcRenderer.invoke('get-all-downloads');
  },

  removeDownload: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('remove-download', id);
  },

  retryDownload: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('retry-download', id);
  },

  pauseDownload: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('pause-download', id);
  },

  resumeDownload: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('resume-download', id);
  },

  addManualDownload: async (magnetLink: string, title?: string): Promise<any> => {
    return await ipcRenderer.invoke('add-manual-download', magnetLink, title);
  },

  // Settings operations
  getSettings: async (): Promise<any> => {
    return await ipcRenderer.invoke('get-settings');
  },

  saveSettings: async (settings: any): Promise<any> => {
    return await ipcRenderer.invoke('save-settings', settings);
  },

  // File system operations
  selectDirectory: async (): Promise<string | null> => {
    return await ipcRenderer.invoke('select-directory');
  },

  openFolder: async (filePath: string): Promise<any> => {
    return await ipcRenderer.invoke('open-folder', filePath);
  },

  getDownloadDirectory: async (): Promise<string> => {
    return await ipcRenderer.invoke('get-download-directory');
  },

  // RSS feed testing
  testRSSFeed: async (url: string): Promise<any> => {
    return await ipcRenderer.invoke('test-rss-feed', url);
  },

  testRSSContinuousNumeration: async (url: string): Promise<any> => {
    return await ipcRenderer.invoke('test-rss-continuous-numeration', url);
  },

  // AniList operations
  anilistGetAuthUrl: async (): Promise<string> => {
    return await ipcRenderer.invoke('anilist-get-auth-url');
  },

  anilistStoreToken: async (token: string): Promise<any> => {
    return await ipcRenderer.invoke('anilist-store-token', token);
  },

  anilistIsAuthenticated: async (): Promise<boolean> => {
    return await ipcRenderer.invoke('anilist-is-authenticated');
  },

  anilistGetCurrentUser: async (): Promise<any> => {
    return await ipcRenderer.invoke('anilist-get-current-user');
  },

  anilistGetUserAnimeList: async (userId?: number, status?: string): Promise<any> => {
    return await ipcRenderer.invoke('anilist-get-user-anime-list', userId, status);
  },

  anilistGetListsByStatus: async (statuses: string[], userId?: number): Promise<any> => {
    return await ipcRenderer.invoke('anilist-get-lists-by-status', statuses, userId);
  },

  anilistSearchAnime: async (search: string, page?: number, perPage?: number): Promise<any> => {
    return await ipcRenderer.invoke('anilist-search-anime', search, page, perPage);
  },

  anilistLogout: async (): Promise<void> => {
    return await ipcRenderer.invoke('anilist-logout');
  },

  // AniList account operations
  anilistAccountsGetAll: async (): Promise<any[]> => {
    return await ipcRenderer.invoke('anilist-accounts-get-all');
  },

  anilistAccountsGetActive: async (): Promise<any> => {
    return await ipcRenderer.invoke('anilist-accounts-get-active');
  },

  anilistAccountsSetActive: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('anilist-accounts-set-active', id);
  },

  anilistAccountsDelete: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('anilist-accounts-delete', id);
  },

  // AniList auto-download lists operations
  anilistAutoListsGetByAccount: async (accountId: number): Promise<any[]> => {
    return await ipcRenderer.invoke('anilist-auto-lists-get-by-account', accountId);
  },

  anilistAutoListsUpsert: async (config: any): Promise<any> => {
    return await ipcRenderer.invoke('anilist-auto-lists-upsert', config);
  },

  anilistAutoListsGetEnabled: async (): Promise<any[]> => {
    return await ipcRenderer.invoke('anilist-auto-lists-get-enabled');
  },

  anilistAutoListsToggle: async (id: number, enabled: boolean): Promise<any> => {
    return await ipcRenderer.invoke('anilist-auto-lists-toggle', id, enabled);
  },

  anilistAutoListsDelete: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('anilist-auto-lists-delete', id);
  },

  // Anime relations operations
  animeRelationsGetEpisodeMapping: async (anilistId: number, episodeNumber: number): Promise<any> => {
    return await ipcRenderer.invoke('anime-relations-get-episode-mapping', anilistId, episodeNumber);
  },

  animeRelationsForceRefresh: async (): Promise<any> => {
    return await ipcRenderer.invoke('anime-relations-force-refresh');
  },

  animeRelationsGetData: async (): Promise<any> => {
    return await ipcRenderer.invoke('anime-relations-get-data');
  },

  // AniList sync operations
  anilistSyncForceAll: async (): Promise<any> => {
    return await ipcRenderer.invoke('anilist-sync-force-all');
  },

  anilistSyncGetStatus: async (): Promise<any> => {
    return await ipcRenderer.invoke('anilist-sync-get-status');
  },

  anilistSyncStartPeriodic: async (): Promise<any> => {
    return await ipcRenderer.invoke('anilist-sync-start-periodic');
  },

  anilistSyncStopPeriodic: async (): Promise<any> => {
    return await ipcRenderer.invoke('anilist-sync-stop-periodic');
  },

  // Config operations
  getConfig: async (key: string): Promise<any> => {
    return await ipcRenderer.invoke('get-config', key);
  },

  setConfig: async (key: string, value: any): Promise<any> => {
    return await ipcRenderer.invoke('set-config', key, value);
  },

  getAllConfig: async (): Promise<any> => {
    return await ipcRenderer.invoke('get-all-config');
  },

  // External operations
  openExternal: async (url: string): Promise<void> => {
    return await ipcRenderer.invoke('open-external', url);
  },

  // Processed files operations
  getProcessedFiles: async (): Promise<any[]> => {
    return await ipcRenderer.invoke('get-processed-files');
  },

  deleteProcessedFile: async (id: number): Promise<any> => {
    return await ipcRenderer.invoke('delete-processed-file', id);
  },

  clearAllProcessedFiles: async (): Promise<any> => {
    return await ipcRenderer.invoke('clear-all-processed-files');
  },

  clearProcessedFilesByWhitelistEntry: async (whitelistEntryId: number): Promise<any> => {
    return await ipcRenderer.invoke('clear-processed-files-by-whitelist-entry', whitelistEntryId);
  },

  debugProcessedFiles: async (): Promise<any[]> => {
    return await ipcRenderer.invoke('debug-processed-files');
  },

  // Filename parsing operations
  parseFilename: async (filename: string): Promise<any> => {
    return await ipcRenderer.invoke('parse-filename', filename);
  },

  parseMultipleFilenames: async (filenames: string[]): Promise<any[]> => {
    return await ipcRenderer.invoke('parse-multiple-filenames', filenames);
  },

  // Title overrides operations
  getUserTitleOverrides: async (): Promise<any> => {
    return await ipcRenderer.invoke('get-user-title-overrides');
  },

  saveUserTitleOverrides: async (overrides: any): Promise<void> => {
    return await ipcRenderer.invoke('save-user-title-overrides', overrides);
  },

  refreshTitleOverrides: async (): Promise<void> => {
    return await ipcRenderer.invoke('refresh-title-overrides');
  },

  // Notification listener
  onAppNotification: (callback: (notification: any) => void): void => {
    ipcRenderer.on('app-notification', (_, notification) => {
      callback(notification);
    });
  },
};

contextBridge.exposeInMainWorld("bridge", CONTEXT_BRIDGE);
