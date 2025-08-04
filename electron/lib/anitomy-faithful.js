/**
 * Anitomy JavaScript Port
 * A faithful port of the C++ Anitomy library for parsing anime filenames
 * Based on the original C++ implementation by Eren Okka
 */

// Element categories (matching C++ enum)
const ElementCategory = {
  ANIME_SEASON: 'animeSeason',
  ANIME_SEASON_PREFIX: 'animeSeasonPrefix',
  ANIME_TITLE: 'animeTitle',
  ANIME_TYPE: 'animeType',
  ANIME_YEAR: 'animeYear',
  AUDIO_TERM: 'audioTerm',
  DEVICE_COMPATIBILITY: 'deviceCompatibility',
  EPISODE_NUMBER: 'episodeNumber',
  EPISODE_NUMBER_ALT: 'episodeNumberAlt',
  EPISODE_PREFIX: 'episodePrefix',
  EPISODE_TITLE: 'episodeTitle',
  FILE_CHECKSUM: 'fileChecksum',
  FILE_EXTENSION: 'fileExtension',
  FILE_NAME: 'fileName',
  LANGUAGE: 'language',
  OTHER: 'other',
  RELEASE_GROUP: 'releaseGroup',
  RELEASE_INFORMATION: 'releaseInformation',
  RELEASE_VERSION: 'releaseVersion',
  SOURCE: 'source',
  SUBTITLES: 'subtitles',
  VIDEO_RESOLUTION: 'videoResolution',
  VIDEO_TERM: 'videoTerm',
  VOLUME_NUMBER: 'volumeNumber',
  VOLUME_PREFIX: 'volumePrefix',
  UNKNOWN: 'unknown'
};

// Token categories (matching C++ enum)
const TokenCategory = {
  UNKNOWN: 'unknown',
  BRACKET: 'bracket',
  DELIMITER: 'delimiter',
  IDENTIFIER: 'identifier',
  INVALID: 'invalid'
};

// Token flags (matching C++ enum)
const TokenFlag = {
  NONE: 0,
  BRACKET: 1 << 0,
  NOT_BRACKET: 1 << 1,
  DELIMITER: 1 << 2,
  NOT_DELIMITER: 1 << 3,
  IDENTIFIER: 1 << 4,
  NOT_IDENTIFIER: 1 << 5,
  UNKNOWN: 1 << 6,
  NOT_UNKNOWN: 1 << 7,
  VALID: 1 << 8,
  NOT_VALID: 1 << 9,
  ENCLOSED: 1 << 10,
  NOT_ENCLOSED: 1 << 11
};

// Constants
const ANIME_YEAR_MIN = 1900;
const ANIME_YEAR_MAX = 2050;
const DASHES = '-\u2010\u2011\u2012\u2013\u2014\u2015';

/**
 * Token class
 */
class Token {
  constructor(category = TokenCategory.UNKNOWN, content = '', enclosed = false) {
    this.category = category;
    this.content = content;
    this.enclosed = enclosed;
  }
}

/**
 * Elements class - manages parsed elements
 */
class Elements {
  constructor() {
    this.elements = new Map();
  }

  clear() {
    this.elements.clear();
  }

  insert(category, value) {
    if (!this.elements.has(category)) {
      this.elements.set(category, []);
    }
    this.elements.get(category).push(value);
  }

  get(category) {
    const values = this.elements.get(category);
    return values && values.length > 0 ? values[0] : '';
  }

  getAll(category) {
    return this.elements.get(category) || [];
  }

  empty(category) {
    const values = this.elements.get(category);
    return !values || values.length === 0;
  }

  erase(category) {
    this.elements.delete(category);
  }
}

/**
 * Options class
 */
class Options {
  constructor() {
    this.allowedDelimiters = ' _.&+,|';
    this.ignoredStrings = [];
    this.parseEpisodeNumber = true;
    this.parseEpisodeTitle = true;
    this.parseFileExtension = true;
    this.parseReleaseGroup = true;
  }
}

/**
 * Utility functions
 */
function isAlphanumericChar(char) {
  return /[a-zA-Z0-9]/.test(char);
}

function isNumericChar(char) {
  return /[0-9]/.test(char);
}

function isNumericString(str) {
  return /^\d+$/.test(str);
}

function isAlphanumericString(str) {
  return /^[a-zA-Z0-9]+$/.test(str);
}

function isHexadecimalString(str) {
  return /^[0-9A-Fa-f]+$/.test(str);
}

function stringToInt(str) {
  return parseInt(str, 10);
}

function findToken(tokens, startIndex, flags) {
  for (let i = startIndex; i < tokens.length; i++) {
    const token = tokens[i];
    if (checkTokenFlags(token, flags)) {
      return i;
    }
  }
  return -1;
}

function findPreviousToken(tokens, startIndex, flags) {
  for (let i = startIndex - 1; i >= 0; i--) {
    const token = tokens[i];
    if (checkTokenFlags(token, flags)) {
      return i;
    }
  }
  return -1;
}

function checkTokenFlags(token, flags) {
  if (flags & TokenFlag.BRACKET && token.category !== TokenCategory.BRACKET) return false;
  if (flags & TokenFlag.NOT_BRACKET && token.category === TokenCategory.BRACKET) return false;
  if (flags & TokenFlag.DELIMITER && token.category !== TokenCategory.DELIMITER) return false;
  if (flags & TokenFlag.NOT_DELIMITER && token.category === TokenCategory.DELIMITER) return false;
  if (flags & TokenFlag.IDENTIFIER && token.category !== TokenCategory.IDENTIFIER) return false;
  if (flags & TokenFlag.NOT_IDENTIFIER && token.category === TokenCategory.IDENTIFIER) return false;
  if (flags & TokenFlag.UNKNOWN && token.category !== TokenCategory.UNKNOWN) return false;
  if (flags & TokenFlag.NOT_UNKNOWN && token.category === TokenCategory.UNKNOWN) return false;
  if (flags & TokenFlag.VALID && token.category === TokenCategory.INVALID) return false;
  if (flags & TokenFlag.NOT_VALID && token.category !== TokenCategory.INVALID) return false;
  if (flags & TokenFlag.ENCLOSED && !token.enclosed) return false;
  if (flags & TokenFlag.NOT_ENCLOSED && token.enclosed) return false;
  return true;
}

/**
 * Tokenizer class - faithful port of C++ tokenizer
 */
class Tokenizer {
  constructor(filename, elements, options, tokens) {
    this.filename = filename;
    this.elements = elements;
    this.options = options;
    this.tokens = tokens;
  }

  tokenize() {
    this.tokens.length = 0; // Clear tokens array
    this.tokenizeByBrackets();
    return this.tokens.length > 0;
  }

  addToken(category, enclosed, offset, size) {
    const content = this.filename.substring(offset, offset + size);
    this.tokens.push(new Token(category, content, enclosed));
  }

  tokenizeByBrackets() {
    const brackets = [
      ['(', ')'],
      ['[', ']'],
      ['{', '}']
    ];

    let isBracketOpen = false;
    let matchingBracket = '';
    let charBegin = 0;

    console.log(`🔍 TOKENIZER: Processing filename: "${this.filename}" (length: ${this.filename.length})`);

    for (let i = 0; i <= this.filename.length; i++) {
      let currentChar = i < this.filename.length ? this.filename[i] : null;
      let foundBracket = false;

      if (!isBracketOpen && currentChar) {
        // Look for opening bracket
        for (const [open, close] of brackets) {
          if (currentChar === open) {
            matchingBracket = close;
            foundBracket = true;
            console.log(`🔍 TOKENIZER: Found opening bracket '${open}' at position ${i}`);
            break;
          }
        }
      } else if (isBracketOpen && currentChar === matchingBracket) {
        foundBracket = true;
        console.log(`🔍 TOKENIZER: Found closing bracket '${currentChar}' at position ${i}`);
      }

      if (foundBracket || i === this.filename.length) {
        const size = i - charBegin;
        if (size > 0) {
          console.log(`🔍 TOKENIZER: Processing segment: "${this.filename.substring(charBegin, i)}" (enclosed: ${isBracketOpen})`);
          this.tokenizeByPreidentified(isBracketOpen, charBegin, size);
        }

        if (foundBracket && i < this.filename.length) {
          this.addToken(TokenCategory.BRACKET, true, i, 1);
          isBracketOpen = !isBracketOpen;
        }

        charBegin = i + 1;
      }
    }

    console.log(`🔍 TOKENIZER: Bracket tokenization complete, ${this.tokens.length} tokens so far`);

    // Validate delimiters once at the end
    this.validateDelimiterTokens();
  }

  tokenizeByPreidentified(enclosed, offset, size) {
    // For now, skip preidentified tokens and go straight to delimiter tokenization
    console.log(`🔍 TOKENIZER: tokenizeByPreidentified called with offset=${offset}, size=${size}, enclosed=${enclosed}`);
    this.tokenizeByDelimiters(enclosed, offset, size);
  }

  tokenizeByDelimiters(enclosed, offset, size) {
    const content = this.filename.substring(offset, offset + size);
    console.log(`🔍 TOKENIZER: tokenizeByDelimiters processing: "${content}" (enclosed=${enclosed})`);
    const delimiters = this.getDelimiters(content);

    if (delimiters.length === 0) {
      if (content.trim()) {
        console.log(`🔍 TOKENIZER: Adding single token: "${content}"`);
        this.addToken(TokenCategory.UNKNOWN, enclosed, offset, size);
      }
      return;
    }

    let charBegin = offset;
    let currentChar = offset;

    while (currentChar < offset + size) {
      const char = this.filename[currentChar];
      
      if (delimiters.includes(char)) {
        const tokenSize = currentChar - charBegin;
        if (tokenSize > 0) {
          this.addToken(TokenCategory.UNKNOWN, enclosed, charBegin, tokenSize);
        }

        this.addToken(TokenCategory.DELIMITER, enclosed, currentChar, 1);
        charBegin = currentChar + 1;
      }
      
      currentChar++;
    }

    // Add remaining content
    const remainingSize = (offset + size) - charBegin;
    if (remainingSize > 0) {
      const remainingContent = this.filename.substring(charBegin, charBegin + remainingSize);
      if (remainingContent.trim()) {
        this.addToken(TokenCategory.UNKNOWN, enclosed, charBegin, remainingSize);
      }
    }

    // Don't validate delimiters here - do it once at the end
  }

  getDelimiters(content) {
    const delimiters = [];
    for (const char of content) {
      if (!isAlphanumericChar(char) && 
          this.options.allowedDelimiters.includes(char) && 
          !delimiters.includes(char)) {
        delimiters.push(char);
      }
    }
    return delimiters;
  }

  validateDelimiterTokens() {
    // Simplified delimiter validation - be more conservative
    const appendTokenTo = (token, appendTo) => {
      appendTo.content += token.content;
      token.category = TokenCategory.INVALID;
    };

    console.log(`🔍 TOKENIZER: Before delimiter validation: ${this.tokens.length} tokens`);
    console.log(`🔍 TOKENIZER: Tokens before validation:`, this.tokens.map(t => `${t.content}(${t.category})`));

    for (let i = 0; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (token.category !== TokenCategory.DELIMITER) continue;

      const delimiter = token.content;
      const prevIndex = findPreviousToken(this.tokens, i, TokenFlag.VALID);
      const nextIndex = findToken(this.tokens, i + 1, TokenFlag.VALID);

      const prevToken = prevIndex >= 0 ? this.tokens[prevIndex] : null;
      const nextToken = nextIndex >= 0 ? this.tokens[nextIndex] : null;

      // Only handle very specific cases to avoid over-merging

      // Check for special cases with & and + between numbers
      if (delimiter === '&' || delimiter === '+') {
        if (prevToken && nextToken &&
            prevToken.category === TokenCategory.UNKNOWN &&
            nextToken.category === TokenCategory.UNKNOWN &&
            isNumericString(prevToken.content) &&
            isNumericString(nextToken.content)) {
          appendTokenTo(token, prevToken);
          appendTokenTo(nextToken, prevToken);
        }
      }
    }

    // Remove invalid tokens
    this.tokens = this.tokens.filter(token => token.category !== TokenCategory.INVALID);
    console.log(`🔍 TOKENIZER: After delimiter validation: ${this.tokens.length} tokens`);
    console.log(`🔍 TOKENIZER: Tokens after validation:`, this.tokens.map(t => `${t.content}(${t.category})`));
  }
}

/**
 * Parser class - faithful port of C++ parser
 */
class Parser {
  constructor(elements, options, tokens) {
    this.elements = elements;
    this.options = options;
    this.tokens = tokens;
  }

  parse() {
    // Follow the exact same order as C++ implementation
    this.searchForKeywords();
    this.searchForIsolatedNumbers();

    if (this.options.parseEpisodeNumber) {
      this.searchForEpisodeNumber();
    }

    this.searchForAnimeTitle();

    if (this.options.parseReleaseGroup && this.elements.empty(ElementCategory.RELEASE_GROUP)) {
      this.searchForReleaseGroup();
    }

    if (this.options.parseEpisodeTitle && !this.elements.empty(ElementCategory.EPISODE_NUMBER)) {
      this.searchForEpisodeTitle();
    }

    this.validateElements();

    return !this.elements.empty(ElementCategory.ANIME_TITLE);
  }

  searchForKeywords() {
    for (let i = 0; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (token.category !== TokenCategory.UNKNOWN) continue;

      let word = token.content.trim();
      if (!word) continue;

      // Check for video resolution
      if (this.elements.empty(ElementCategory.VIDEO_RESOLUTION) && this.isResolution(word)) {
        this.elements.insert(ElementCategory.VIDEO_RESOLUTION, word);
        token.category = TokenCategory.IDENTIFIER;
        continue;
      }

      // Check for CRC32
      if (this.elements.empty(ElementCategory.FILE_CHECKSUM) && this.isCrc32(word)) {
        this.elements.insert(ElementCategory.FILE_CHECKSUM, word);
        token.category = TokenCategory.IDENTIFIER;
        continue;
      }

      // Check for other video terms
      if (this.isVideoTerm(word)) {
        this.elements.insert(ElementCategory.VIDEO_TERM, word);
        token.category = TokenCategory.IDENTIFIER;
        continue;
      }

      // Check for audio terms
      if (this.isAudioTerm(word)) {
        this.elements.insert(ElementCategory.AUDIO_TERM, word);
        token.category = TokenCategory.IDENTIFIER;
        continue;
      }
    }
  }

  searchForIsolatedNumbers() {
    for (let i = 0; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (token.category !== TokenCategory.UNKNOWN ||
          !isNumericString(token.content) ||
          !this.isTokenIsolated(i)) {
        continue;
      }

      const number = stringToInt(token.content);

      // Anime year
      if (number >= ANIME_YEAR_MIN && number <= ANIME_YEAR_MAX) {
        if (this.elements.empty(ElementCategory.ANIME_YEAR)) {
          this.elements.insert(ElementCategory.ANIME_YEAR, token.content);
          token.category = TokenCategory.IDENTIFIER;
          continue;
        }
      }

      // Video resolution (480, 720, 1080 without 'p')
      if (number === 480 || number === 720 || number === 1080) {
        if (this.elements.empty(ElementCategory.VIDEO_RESOLUTION)) {
          this.elements.insert(ElementCategory.VIDEO_RESOLUTION, token.content);
          token.category = TokenCategory.IDENTIFIER;
          continue;
        }
      }
    }
  }

  searchForEpisodeNumber() {
    // Find all unknown tokens that contain numbers
    const numericTokens = [];
    for (let i = 0; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (token.category === TokenCategory.UNKNOWN && /\d/.test(token.content)) {
        numericTokens.push(i);
      }
    }

    if (numericTokens.length === 0) return;

    // Look for episode patterns (e.g., "S01E17", "2x01", "#01")
    if (this.searchForEpisodePatterns(numericTokens)) return;

    // Look for separated numbers (e.g., " - 08")
    if (this.searchForSeparatedNumbers(numericTokens)) return;

    // Look for isolated episode numbers
    if (this.searchForIsolatedEpisodeNumbers(numericTokens)) return;
  }

  searchForEpisodePatterns(numericTokens) {
    for (const tokenIndex of numericTokens) {
      const token = this.tokens[tokenIndex];

      // Skip if it's purely numeric (handled by other methods)
      if (isNumericString(token.content)) continue;

      const word = token.content.trim();

      // Season and Episode pattern: S01E17, 2x01, S01-02xE001-150
      if (this.matchSeasonAndEpisodePattern(word, token)) return true;

      // Number sign pattern: #01, #02-03
      if (this.matchNumberSignPattern(word, token)) return true;

      // Single episode with version: 01v2
      if (this.matchSingleEpisodePattern(word, token)) return true;

      // Multi-episode pattern: 01-02, 03-05v2
      if (this.matchMultiEpisodePattern(word, token)) return true;
    }
    return false;
  }

  matchSeasonAndEpisodePattern(word, token) {
    // Pattern: S01E17, 2x01, S01-02xE001-150
    const pattern = /^S?(\d{1,2})(?:-S?(\d{1,2}))?(?:x|[ ._-x]?E)(\d{1,4})(?:-E?(\d{1,4}))?(?:[vV](\d))?$/i;
    const match = word.match(pattern);

    if (match) {
      const season = match[1];
      const episodeNumber = match[3];

      // Skip if season is 0
      if (parseInt(season) === 0) return false;

      // Set season
      this.elements.insert(ElementCategory.ANIME_SEASON, season);
      if (match[2]) {
        this.elements.insert(ElementCategory.ANIME_SEASON, match[2]);
      }

      // Set episode number
      this.elements.insert(ElementCategory.EPISODE_NUMBER, episodeNumber);
      if (match[4]) {
        this.elements.insert(ElementCategory.EPISODE_NUMBER, match[4]);
      }

      // Set version if present
      if (match[5]) {
        this.elements.insert(ElementCategory.RELEASE_VERSION, match[5]);
      }

      token.category = TokenCategory.IDENTIFIER;
      return true;
    }

    return false;
  }

  matchNumberSignPattern(word, token) {
    // Pattern: #01, #02-03v2
    const pattern = /^#(\d{1,4})(?:[-~&+](\d{1,4}))?(?:[vV](\d))?$/;
    const match = word.match(pattern);

    if (match) {
      this.elements.insert(ElementCategory.EPISODE_NUMBER, match[1]);
      if (match[2]) {
        this.elements.insert(ElementCategory.EPISODE_NUMBER, match[2]);
      }
      if (match[3]) {
        this.elements.insert(ElementCategory.RELEASE_VERSION, match[3]);
      }

      token.category = TokenCategory.IDENTIFIER;
      return true;
    }

    return false;
  }

  matchSingleEpisodePattern(word, token) {
    // Pattern: 01v2
    const pattern = /^(\d{1,4})[vV](\d)$/;
    const match = word.match(pattern);

    if (match) {
      this.elements.insert(ElementCategory.EPISODE_NUMBER, match[1]);
      this.elements.insert(ElementCategory.RELEASE_VERSION, match[2]);
      token.category = TokenCategory.IDENTIFIER;
      return true;
    }

    return false;
  }

  matchMultiEpisodePattern(word, token) {
    // Pattern: 01-02, 03-05v2
    const pattern = /^(\d{1,4})(?:[vV](\d))?[-~&+](\d{1,4})(?:[vV](\d))?$/;
    const match = word.match(pattern);

    if (match) {
      const lowerBound = parseInt(match[1]);
      const upperBound = parseInt(match[3]);

      // Avoid matching expressions such as "009-1" or "5-2"
      if (lowerBound < upperBound) {
        this.elements.insert(ElementCategory.EPISODE_NUMBER, match[1]);
        this.elements.insert(ElementCategory.EPISODE_NUMBER, match[3]);

        if (match[2]) {
          this.elements.insert(ElementCategory.RELEASE_VERSION, match[2]);
        }
        if (match[4]) {
          this.elements.insert(ElementCategory.RELEASE_VERSION, match[4]);
        }

        token.category = TokenCategory.IDENTIFIER;
        return true;
      }
    }

    return false;
  }

  searchForSeparatedNumbers(numericTokens) {
    for (const tokenIndex of numericTokens) {
      const token = this.tokens[tokenIndex];
      if (!isNumericString(token.content)) continue;

      // Look for preceding dash
      const prevIndex = findPreviousToken(this.tokens, tokenIndex, TokenFlag.NOT_DELIMITER);
      if (prevIndex >= 0) {
        const prevToken = this.tokens[prevIndex];
        if (this.isDashCharacter(prevToken.content)) {
          const number = stringToInt(token.content);
          if (number >= 1 && number <= 9999) {
            this.elements.insert(ElementCategory.EPISODE_NUMBER, token.content);
            token.category = TokenCategory.IDENTIFIER;
            return true;
          }
        }
      }
    }
    return false;
  }

  searchForIsolatedEpisodeNumbers(numericTokens) {
    for (const tokenIndex of numericTokens) {
      const token = this.tokens[tokenIndex];
      if (!isNumericString(token.content) || !this.isTokenIsolated(tokenIndex)) continue;

      const number = stringToInt(token.content);
      if (number >= 1 && number <= 9999) {
        this.elements.insert(ElementCategory.EPISODE_NUMBER, token.content);
        token.category = TokenCategory.IDENTIFIER;
        return true;
      }
    }
    return false;
  }

  searchForAnimeTitle() {
    // Find the first non-enclosed unknown token
    let tokenBegin = findToken(this.tokens, 0, TokenFlag.NOT_ENCLOSED | TokenFlag.UNKNOWN);
    let enclosedTitle = false;

    // If that doesn't work, find the first unknown token in the second enclosed group
    if (tokenBegin === -1) {
      enclosedTitle = true;
      tokenBegin = findToken(this.tokens, 0, TokenFlag.UNKNOWN);
      // Skip first group (likely release group)
      if (tokenBegin >= 0) {
        const nextBracket = findToken(this.tokens, tokenBegin, TokenFlag.BRACKET);
        if (nextBracket >= 0) {
          tokenBegin = findToken(this.tokens, nextBracket + 1, TokenFlag.UNKNOWN);
        }
      }
    }

    if (tokenBegin === -1) return;

    // Continue until an identifier or bracket is found
    let tokenEnd = findToken(this.tokens, tokenBegin + 1,
      TokenFlag.IDENTIFIER | (enclosedTitle ? TokenFlag.BRACKET : TokenFlag.NONE));

    if (tokenEnd === -1) tokenEnd = this.tokens.length;

    // Build anime title from token range
    this.buildElement(ElementCategory.ANIME_TITLE, false, tokenBegin, tokenEnd);
  }

  searchForReleaseGroup() {
    let tokenBegin = 0;

    while (tokenBegin < this.tokens.length) {
      // Find the first enclosed unknown token
      tokenBegin = findToken(this.tokens, tokenBegin, TokenFlag.ENCLOSED | TokenFlag.UNKNOWN);
      if (tokenBegin === -1) return;

      // Find the next bracket (closing bracket of this group)
      let tokenEnd = findToken(this.tokens, tokenBegin + 1, TokenFlag.BRACKET);
      if (tokenEnd === -1) {
        tokenBegin++;
        continue;
      }

      // Check if this looks like a valid release group
      // (not just a single character, and enclosed)
      const groupContent = this.tokens[tokenBegin].content;
      if (groupContent && groupContent.length > 1) {
        // Build release group - only include the content, not the brackets
        this.buildElement(ElementCategory.RELEASE_GROUP, false, tokenBegin, tokenEnd);
        return;
      }

      tokenBegin++;
    }
  }

  searchForEpisodeTitle() {
    let tokenBegin = 0;

    while (tokenBegin < this.tokens.length) {
      // Find the first non-enclosed unknown token
      tokenBegin = findToken(this.tokens, tokenBegin, TokenFlag.NOT_ENCLOSED | TokenFlag.UNKNOWN);
      if (tokenBegin === -1) return;

      // Continue until a bracket or identifier is found
      let tokenEnd = findToken(this.tokens, tokenBegin + 1, TokenFlag.BRACKET | TokenFlag.IDENTIFIER);
      if (tokenEnd === -1) tokenEnd = this.tokens.length;

      // Ignore if it's only a dash
      if (tokenEnd - tokenBegin <= 2 && this.isDashCharacter(this.tokens[tokenBegin].content)) {
        tokenBegin++;
        continue;
      }

      // Build episode title
      this.buildElement(ElementCategory.EPISODE_TITLE, false, tokenBegin, tokenEnd);
      return;
    }
  }

  buildElement(category, keepDelimiters, tokenBegin, tokenEnd) {
    let element = '';

    for (let i = tokenBegin; i < tokenEnd && i < this.tokens.length; i++) {
      const token = this.tokens[i];

      switch (token.category) {
        case TokenCategory.UNKNOWN:
          element += token.content;
          token.category = TokenCategory.IDENTIFIER;
          break;
        case TokenCategory.BRACKET:
          element += token.content;
          break;
        case TokenCategory.DELIMITER:
          const delimiter = token.content;
          if (keepDelimiters) {
            element += delimiter;
          } else if (i !== tokenBegin && i !== tokenEnd - 1) {
            // Preserve commas and ampersands, convert others to spaces
            switch (delimiter) {
              case ',':
              case '&':
                element += delimiter;
                break;
              default:
                element += ' ';
                break;
            }
          }
          break;
        default:
          break;
      }
    }

    if (!keepDelimiters) {
      // Trim dashes and spaces from the ends
      element = element.replace(/^[\s\-]+|[\s\-]+$/g, '');
    }

    if (element) {
      this.elements.insert(category, element);
    }
  }

  validateElements() {
    // Basic validation - can be expanded
  }

  // Helper methods
  isTokenIsolated(tokenIndex) {
    const prevIndex = findPreviousToken(this.tokens, tokenIndex, TokenFlag.VALID);
    const nextIndex = findToken(this.tokens, tokenIndex + 1, TokenFlag.VALID);

    const prevToken = prevIndex >= 0 ? this.tokens[prevIndex] : null;
    const nextToken = nextIndex >= 0 ? this.tokens[nextIndex] : null;

    return (!prevToken || prevToken.category === TokenCategory.BRACKET) &&
           (!nextToken || nextToken.category === TokenCategory.BRACKET);
  }

  isCrc32(str) {
    return str.length === 8 && isHexadecimalString(str);
  }

  isDashCharacter(str) {
    return str.length === 1 && DASHES.includes(str);
  }

  isResolution(str) {
    // Check for patterns like "720p", "1080p", "1920x1080"
    if (/^\d{3,4}p$/i.test(str)) return true;
    if (/^\d{3,4}x\d{3,4}$/i.test(str)) return true;
    return false;
  }

  isVideoTerm(str) {
    const videoTerms = [
      'h264', 'h.264', 'x264', 'x.264',
      'h265', 'h.265', 'x265', 'x.265', 'hevc',
      'xvid', 'divx', 'wmv', 'mpeg', 'mp4',
      'mkv', 'avi', 'mov', 'flv', 'webm',
      'bd', 'bluray', 'blu-ray', 'dvd', 'hdtv',
      'webrip', 'web-rip', 'bdrip', 'bd-rip',
      'dvdrip', 'dvd-rip', 'hdcam', 'cam'
    ];
    return videoTerms.includes(str.toLowerCase());
  }

  isAudioTerm(str) {
    const audioTerms = [
      'aac', 'ac3', 'dts', 'flac', 'mp3',
      'ogg', 'vorbis', 'opus', 'pcm',
      '2.0', '2.1', '5.1', '7.1'
    ];
    return audioTerms.includes(str.toLowerCase());
  }
}

/**
 * Main Anitomy class - faithful port of C++ Anitomy
 */
class Anitomy {
  constructor() {
    this.elements = new Elements();
    this.options = new Options();
    this.tokens = [];
  }

  parse(filename) {
    this.elements.clear();
    this.tokens.length = 0;

    if (!filename || typeof filename !== 'string') {
      return false;
    }

    console.log(`🔍 ANITOMY: Starting parse of: "${filename}"`);
    let processedFilename = filename;

    // Extract file extension
    if (this.options.parseFileExtension) {
      const extension = this.removeExtensionFromFilename(processedFilename);
      if (extension) {
        this.elements.insert(ElementCategory.FILE_EXTENSION, extension);
        processedFilename = processedFilename.substring(0, processedFilename.lastIndexOf('.'));
      }
    }

    // Remove ignored strings
    if (this.options.ignoredStrings.length > 0) {
      processedFilename = this.removeIgnoredStrings(processedFilename);
    }

    if (!processedFilename.trim()) {
      return false;
    }

    this.elements.insert(ElementCategory.FILE_NAME, processedFilename);

    // Tokenize
    console.log(`🔍 ANITOMY: Tokenizing: "${processedFilename}"`);
    const tokenizer = new Tokenizer(processedFilename, this.elements, this.options, this.tokens);
    if (!tokenizer.tokenize()) {
      console.log(`❌ ANITOMY: Tokenization failed`);
      return false;
    }
    console.log(`🔍 ANITOMY: Tokenization complete, ${this.tokens.length} tokens created`);

    // Parse
    const parser = new Parser(this.elements, this.options, this.tokens);
    if (!parser.parse()) {
      return false;
    }

    return true;
  }

  removeExtensionFromFilename(filename) {
    const position = filename.lastIndexOf('.');
    if (position === -1) return null;

    const extension = filename.substring(position + 1);
    const maxLength = 4;

    if (extension.length > maxLength) return null;
    if (!isAlphanumericString(extension)) return null;

    // Basic extension validation
    const validExtensions = ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'];
    if (!validExtensions.includes(extension.toLowerCase())) return null;

    return extension;
  }

  removeIgnoredStrings(filename) {
    let result = filename;
    for (const str of this.options.ignoredStrings) {
      result = result.replace(new RegExp(str, 'gi'), '');
    }
    return result;
  }

  // Getters for accessing results
  get(category) {
    return this.elements.get(category);
  }

  getAll(category) {
    return this.elements.getAll(category);
  }
}

module.exports = {
  Anitomy,
  ElementCategory,
  TokenCategory,
  TokenFlag,
  Token,
  Elements,
  Options,
  Tokenizer,
  Parser
};
