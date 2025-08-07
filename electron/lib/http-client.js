const axios = require('axios');

/**
 * Shared HTTP client configuration for MoeDownloader
 */
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_USER_AGENT = 'MoeDownloader/1.0';

/**
 * Create an axios instance with default configuration
 * @param {Object} options - Additional options
 * @param {number} options.timeout - Request timeout in milliseconds
 * @param {string} options.userAgent - User agent string
 * @param {Object} options.headers - Additional headers
 * @returns {Object} - Configured axios instance
 */
function createHttpClient(options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    userAgent = DEFAULT_USER_AGENT,
    headers = {}
  } = options;

  return axios.create({
    timeout,
    headers: {
      'User-Agent': userAgent,
      ...headers
    }
  });
}

/**
 * Make a GET request with default MoeDownloader configuration
 * @param {string} url - URL to fetch
 * @param {Object} options - Request options
 * @returns {Promise} - Axios response promise
 */
async function get(url, options = {}) {
  const client = createHttpClient(options);
  return await client.get(url, options);
}

/**
 * Make a POST request with default MoeDownloader configuration
 * @param {string} url - URL to post to
 * @param {Object} data - Data to send
 * @param {Object} options - Request options
 * @returns {Promise} - Axios response promise
 */
async function post(url, data, options = {}) {
  const client = createHttpClient(options);
  return await client.post(url, data, options);
}

module.exports = {
  createHttpClient,
  get,
  post,
  DEFAULT_TIMEOUT,
  DEFAULT_USER_AGENT
};
