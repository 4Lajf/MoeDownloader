const axios = require('axios');
const { configOperations } = require('../lib/database');

const ANILIST_API_URL = 'https://graphql.anilist.co';
const ANILIST_AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize';

// AniList media list status constants
const MediaListStatus = {
  CURRENT: 'CURRENT',
  PLANNING: 'PLANNING',
  COMPLETED: 'COMPLETED',
  DROPPED: 'DROPPED',
  PAUSED: 'PAUSED',
  REPEATING: 'REPEATING'
};

/**
 * AniList API Service
 * Handles authentication and API interactions with AniList
 */
function createAniListService() {
  let accessToken = null;
  let currentUser = null;

  const service = {
    /**
     * Initialize the AniList service
     */
    async initialize() {
      try {
        // Load existing access token if available
        accessToken = configOperations.get('anilist_access_token');
        
        if (accessToken) {
          // Verify token is still valid
          const isValid = await this.verifyToken();
          if (!isValid) {
            accessToken = null;
            configOperations.delete('anilist_access_token');
            configOperations.delete('anilist_user_id');
            configOperations.delete('anilist_username');
          } else {
            // Load user info
            currentUser = {
              id: configOperations.get('anilist_user_id'),
              name: configOperations.get('anilist_username')
            };
          }
        }
        
        console.log('AniList service initialized');
        return { success: true, authenticated: !!accessToken };
      } catch (error) {
        console.error('Failed to initialize AniList service:', error);
        throw error;
      }
    },

    /**
     * Get authentication URL for OAuth flow using Implicit Grant
     * @returns {string} - Authentication URL
     */
    getAuthUrl() {
      const clientId = '29090'; // Pre-configured client ID
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'token' // Use token for implicit grant
      });

      return `${ANILIST_AUTH_URL}?${params.toString()}`;
    },

    /**
     * Store access token from implicit grant
     * @param {string} token - Access token from OAuth callback
     * @returns {Object} - Success response with user info
     */
    async storeAccessToken(token) {
      try {
        // Store the access token
        accessToken = token;
        configOperations.set('anilist_access_token', accessToken);

        // Get and store user info
        const user = await this.getCurrentUser();
        if (user) {
          currentUser = user;
          configOperations.set('anilist_user_id', user.id.toString());
          configOperations.set('anilist_username', user.name);
        }

        return {
          success: true,
          user: user
        };
      } catch (error) {
        console.error('Error storing access token:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    /**
     * Verify if the current access token is valid
     * @returns {boolean} - True if token is valid
     */
    async verifyToken() {
      if (!accessToken) return false;

      try {
        const user = await this.getCurrentUser();
        return !!user;
      } catch (error) {
        console.error('Token verification failed:', error);
        return false;
      }
    },

    /**
     * Get current authenticated user
     * @returns {Object|null} - User object or null
     */
    async getCurrentUser() {
      if (!accessToken) return null;

      const query = `
        query {
          Viewer {
            id
            name
            avatar {
              large
              medium
            }
            bannerImage
            about
            statistics {
              anime {
                count
                meanScore
                minutesWatched
              }
            }
          }
        }
      `;

      try {
        const response = await this.makeGraphQLRequest(query);
        return response.data.Viewer;
      } catch (error) {
        console.error('Failed to get current user:', error);
        return null;
      }
    },

    /**
     * Get user's anime list
     * @param {number} userId - User ID (optional, uses current user if not provided)
     * @param {string} status - Media list status (optional)
     * @returns {Object} - Media list collection
     */
    async getUserAnimeList(userId = null, status = null) {
      const targetUserId = userId || (currentUser ? currentUser.id : null);
      if (!targetUserId) {
        throw new Error('No user ID provided and no authenticated user');
      }

      const statusFilter = status ? `, status: ${status}` : '';
      
      const query = `
        query ($userId: Int!) {
          MediaListCollection(userId: $userId, type: ANIME${statusFilter}) {
            lists {
              name
              status
              entries {
                id
                status
                score
                progress
                progressVolumes
                repeat
                priority
                private
                notes
                hiddenFromStatusLists
                customLists
                advancedScores
                startedAt {
                  year
                  month
                  day
                }
                completedAt {
                  year
                  month
                  day
                }
                updatedAt
                createdAt
                media {
                  id
                  title {
                    romaji
                    english
                    native
                    userPreferred
                  }
                  synonyms
                  format
                  status
                  episodes
                  duration
                  chapters
                  volumes
                  season
                  seasonYear
                  averageScore
                  meanScore
                  popularity
                  favourites
                  genres
                  tags {
                    id
                    name
                    description
                    category
                    rank
                    isGeneralSpoiler
                    isMediaSpoiler
                    isAdult
                  }
                  coverImage {
                    large
                    medium
                    color
                  }
                  bannerImage
                  startDate {
                    year
                    month
                    day
                  }
                  endDate {
                    year
                    month
                    day
                  }
                  studios {
                    nodes {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }
      `;

      try {
        const response = await this.makeGraphQLRequest(query, { userId: targetUserId });
        return response.data.MediaListCollection;
      } catch (error) {
        console.error('Failed to get user anime list:', error);
        throw error;
      }
    },

    /**
     * Get anime lists by status
     * @param {string[]} statuses - Array of statuses to fetch
     * @param {number} userId - User ID (optional)
     * @returns {Object} - Object with status as key and entries as value
     */
    async getAnimeListsByStatus(statuses = [MediaListStatus.CURRENT], userId = null) {
      const result = {};
      
      for (const status of statuses) {
        try {
          const collection = await this.getUserAnimeList(userId, status);
          const entries = [];
          
          if (collection && collection.lists) {
            for (const list of collection.lists) {
              if (list.entries) {
                entries.push(...list.entries);
              }
            }
          }
          
          result[status] = entries;
        } catch (error) {
          console.error(`Failed to get ${status} list:`, error);
          result[status] = [];
        }
      }
      
      return result;
    },

    /**
     * Search for anime
     * @param {string} search - Search query
     * @param {number} page - Page number (default: 1)
     * @param {number} perPage - Items per page (default: 10)
     * @returns {Object} - Search results
     */
    async searchAnime(search, page = 1, perPage = 10) {
      const query = `
        query ($search: String!, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              currentPage
              lastPage
              hasNextPage
              perPage
            }
            media(search: $search, type: ANIME) {
              id
              title {
                romaji
                english
                native
                userPreferred
              }
              synonyms
              format
              status
              episodes
              season
              seasonYear
              averageScore
              coverImage {
                large
                medium
              }
              genres
            }
          }
        }
      `;

      try {
        const response = await this.makeGraphQLRequest(query, {
          search,
          page,
          perPage
        });
        return response.data.Page;
      } catch (error) {
        console.error('Failed to search anime:', error);
        throw error;
      }
    },

    /**
     * Make a GraphQL request to AniList API
     * @param {string} query - GraphQL query
     * @param {Object} variables - Query variables
     * @returns {Object} - API response
     */
    async makeGraphQLRequest(query, variables = {}) {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      try {
        const response = await axios.post(ANILIST_API_URL, {
          query,
          variables
        }, {
          headers,
          timeout: 30000
        });

        if (response.data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
        }

        return response.data;
      } catch (error) {
        if (error.response && error.response.status === 401) {
          // Token expired or invalid
          accessToken = null;
          currentUser = null;
          configOperations.delete('anilist_access_token');
          configOperations.delete('anilist_user_id');
          configOperations.delete('anilist_username');
        }
        throw error;
      }
    },

    /**
     * Check if user is authenticated
     * @returns {boolean} - True if authenticated
     */
    isAuthenticated() {
      return !!accessToken;
    },

    /**
     * Get current user info
     * @returns {Object|null} - Current user or null
     */
    getCurrentUserInfo() {
      return currentUser;
    },

    /**
     * Logout user
     */
    logout() {
      accessToken = null;
      currentUser = null;
      configOperations.delete('anilist_access_token');
      configOperations.delete('anilist_user_id');
      configOperations.delete('anilist_username');
    }
  };

  return service;
}

module.exports = {
  createAniListService,
  MediaListStatus
};
