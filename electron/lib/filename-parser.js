const { Anitomy, ElementCategory } = require('./anitomy');

/**
 * Filename Parser Utility
 * Provides a simple interface to parse anime filenames using the Anitomy library
 */
class FilenameParser {
  constructor() {
    this.anitomy = new Anitomy();
  }

  /**
   * Parse an anime filename and extract metadata
   * @param {string} filename - The filename to parse
   * @returns {Object} - Parsed metadata object
   */
  parse(filename) {
    // console.log(`🔍 PARSE: Parsing filename: "${filename}"`);
    // console.log(`🔍 PARSE: Filename length: ${filename.length}`);

    if (!filename || typeof filename !== 'string') {
      // console.log(`❌ PARSE: Invalid filename input`);
      return null;
    }

    const success = this.anitomy.parse(filename);
    if (!success) {
      // console.log(`❌ PARSE: Anitomy parsing failed`);
      return null;
    }

    // Debug: Log the tokens to see what's being parsed
    // console.log(`🔍 PARSE: Tokens created:`, this.anitomy.tokens.map(t => ({
    //   category: t.category,
    //   content: t.content,
    //   enclosed: t.enclosed
    // })));

    const result = {
      // Basic information
      filename: this.anitomy.get(ElementCategory.FILE_NAME) || filename,
      animeTitle: this.anitomy.get(ElementCategory.ANIME_TITLE) || '',
      episodeNumber: this.anitomy.get(ElementCategory.EPISODE_NUMBER) || '',
      episodeTitle: this.anitomy.get(ElementCategory.EPISODE_TITLE) || '',

      // Release information
      releaseGroup: this.anitomy.get(ElementCategory.RELEASE_GROUP) || '',
      releaseVersion: this.anitomy.get(ElementCategory.RELEASE_VERSION) || '',
      releaseInformation: this.anitomy.get(ElementCategory.RELEASE_INFORMATION) || '',

      // Technical details
      videoResolution: this.anitomy.get(ElementCategory.VIDEO_RESOLUTION) || '',
      videoTerm: this.anitomy.get(ElementCategory.VIDEO_TERM) || '',
      audioTerm: this.anitomy.get(ElementCategory.AUDIO_TERM) || '',
      source: this.anitomy.get(ElementCategory.SOURCE) || '',

      // File details
      fileExtension: this.anitomy.get(ElementCategory.FILE_EXTENSION) || '',
      fileChecksum: this.anitomy.get(ElementCategory.FILE_CHECKSUM) || '',

      // Additional metadata
      animeYear: this.anitomy.get(ElementCategory.ANIME_YEAR) || '',
      animeSeason: this.anitomy.get(ElementCategory.ANIME_SEASON) || '',
      animeType: this.anitomy.get(ElementCategory.ANIME_TYPE) || '',
      language: this.anitomy.get(ElementCategory.LANGUAGE) || '',
      subtitles: this.anitomy.get(ElementCategory.SUBTITLES) || '',
      volumeNumber: this.anitomy.get(ElementCategory.VOLUME_NUMBER) || '',
      tokens: this.anitomy.tokens.map(token => ({
        category: token.category,
        content: token.content,
        enclosed: token.enclosed
      }))
    };

    // console.log(`✅ PARSE: Successfully parsed filename. Key data:`, {
    //   animeTitle: result.animeTitle,
    //   episodeNumber: result.episodeNumber,
    //   releaseGroup: result.releaseGroup,
    //   videoResolution: result.videoResolution,
    //   fileExtension: result.fileExtension
    // });

    return result;
  }

  /**
   * Parse multiple filenames
   * @param {string[]} filenames - Array of filenames to parse
   * @returns {Object[]} - Array of parsed metadata objects
   */
  parseMultiple(filenames) {
    if (!Array.isArray(filenames)) {
      return [];
    }

    return filenames.map(filename => this.parse(filename)).filter(result => result !== null);
  }

  /**
   * Extract just the anime title from a filename
   * @param {string} filename - The filename to parse
   * @returns {string} - The extracted anime title or empty string
   */
  extractTitle(filename) {
    const result = this.parse(filename);
    return result ? result.animeTitle : '';
  }

  /**
   * Extract just the episode number from a filename
   * @param {string} filename - The filename to parse
   * @returns {string} - The extracted episode number or empty string
   */
  extractEpisodeNumber(filename) {
    const result = this.parse(filename);
    return result ? result.episodeNumber : '';
  }

  /**
   * Extract just the release group from a filename
   * @param {string} filename - The filename to parse
   * @returns {string} - The extracted release group or empty string
   */
  extractReleaseGroup(filename) {
    const result = this.parse(filename);
    return result ? result.releaseGroup : '';
  }

  /**
   * Check if a filename matches expected patterns for anime files
   * @param {string} filename - The filename to check
   * @returns {boolean} - True if it looks like an anime filename
   */
  isAnimeFile(filename) {
    if (!filename || typeof filename !== 'string') {
      return false;
    }

    // Check for common anime file extensions
    const animeExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    const hasAnimeExtension = animeExtensions.some(ext => 
      filename.toLowerCase().endsWith(ext)
    );

    if (!hasAnimeExtension) {
      return false;
    }

    // Try to parse and see if we get meaningful results
    const result = this.parse(filename);
    if (!result) {
      return false;
    }

    // Check if we extracted at least a title or episode number
    return !!(result.animeTitle || result.episodeNumber || result.releaseGroup);
  }

  /**
   * Normalize a filename for comparison purposes
   * @param {string} filename - The filename to normalize
   * @returns {string} - Normalized filename
   */
  normalize(filename) {
    if (!filename || typeof filename !== 'string') {
      return '';
    }

    const result = this.parse(filename);
    if (!result) {
      return filename.toLowerCase().trim();
    }

    // Create a normalized representation
    const parts = [];
    
    if (result.animeTitle) {
      parts.push(result.animeTitle.toLowerCase().trim());
    }
    
    if (result.episodeNumber) {
      parts.push(`ep${result.episodeNumber.padStart(2, '0')}`);
    }
    
    if (result.releaseGroup) {
      parts.push(`[${result.releaseGroup.toLowerCase()}]`);
    }

    return parts.join(' ') || filename.toLowerCase().trim();
  }

  /**
   * Get parser options
   * @returns {Object} - Current parser options
   */
  getOptions() {
    return this.anitomy.getOptions();
  }

  /**
   * Set parser options
   * @param {Object} options - Options to set
   */
  setOptions(options) {
    const currentOptions = this.anitomy.getOptions();
    Object.assign(currentOptions, options);
  }
}

// Create a singleton instance for easy use
const filenameParser = new FilenameParser();

/**
 * Quick parse function for convenience
 * @param {string} filename - The filename to parse
 * @returns {Object} - Parsed metadata object
 */
function parseFilename(filename) {
  return filenameParser.parse(filename);
}

/**
 * Quick title extraction function
 * @param {string} filename - The filename to parse
 * @returns {string} - The extracted anime title
 */
function extractAnimeTitle(filename) {
  return filenameParser.extractTitle(filename);
}

/**
 * Quick episode number extraction function
 * @param {string} filename - The filename to parse
 * @returns {string} - The extracted episode number
 */
function extractEpisodeNumber(filename) {
  return filenameParser.extractEpisodeNumber(filename);
}

/**
 * Quick release group extraction function
 * @param {string} filename - The filename to parse
 * @returns {string} - The extracted release group
 */
function extractReleaseGroup(filename) {
  return filenameParser.extractReleaseGroup(filename);
}

module.exports = {
  FilenameParser,
  parseFilename,
  extractAnimeTitle,
  extractEpisodeNumber,
  extractReleaseGroup,
  filenameParser
};
