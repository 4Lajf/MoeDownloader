const path = require('path');

// Import the anitomy library
const anitomyPath = path.join(__dirname, '..', 'lib', 'anitomy-faithful.js');
const anitomyModule = require(anitomyPath);

function testAnitomyParsing() {
  console.log('🧪 Testing Anitomy Parsing...\n');

  // Test case from the user's example
  const testTitle = "Sword of the Demon Hunter S01E17 1080p ADN WEB-DL AAC2.0 H 264-VARYG (Kijin Gentoushou, Multi-Subs)";
  
  console.log(`🧪 TEST: Result 1:`);
  console.log(`[1]   Original Title: ${testTitle}`);
  
  try {
    const anitomy = new anitomyModule.Anitomy();
    const result = anitomy.parse(testTitle);
    
    if (result) {
      console.log(`[1]   Parsed Data: {`);
      console.log(`[1]     "filename": "${anitomy.elements.get('file_name') || testTitle}",`);
      console.log(`[1]     "animeTitle": "${anitomy.elements.get('anime_title') || ''}",`);
      console.log(`[1]     "episodeNumber": "${anitomy.elements.get('episode_number') || ''}",`);
      console.log(`[1]     "episodeTitle": "${anitomy.elements.get('episode_title') || ''}",`);
      console.log(`[1]     "releaseGroup": "${anitomy.elements.get('release_group') || ''}",`);
      console.log(`[1]     "releaseVersion": "${anitomy.elements.get('release_version') || ''}",`);
      console.log(`[1]     "releaseInformation": "${anitomy.elements.get('release_information') || ''}",`);
      console.log(`[1]     "videoResolution": "${anitomy.elements.get('video_resolution') || ''}",`);
      console.log(`[1]     "videoTerm": "${anitomy.elements.get('video_term') || ''}",`);
      console.log(`[1]     "audioTerm": "${anitomy.elements.get('audio_term') || ''}",`);
      console.log(`[1]     "source": "${anitomy.elements.get('source') || ''}",`);
      console.log(`[1]     "fileExtension": "${anitomy.elements.get('file_extension') || ''}",`);
      console.log(`[1]     "fileChecksum": "${anitomy.elements.get('file_checksum') || ''}",`);
      console.log(`[1]     "animeYear": "${anitomy.elements.get('anime_year') || ''}",`);
      console.log(`[1]     "animeSeason": "${anitomy.elements.get('anime_season') || ''}",`);
      console.log(`[1]     "animeType": "${anitomy.elements.get('anime_type') || ''}",`);
      console.log(`[1]     "language": "${anitomy.elements.get('language') || ''}",`);
      console.log(`[1]     "subtitles": "${anitomy.elements.get('subtitles') || ''}",`);
      console.log(`[1]     "volumeNumber": "${anitomy.elements.get('volume_number') || ''}",`);
      console.log(`[1]     "tokens": [`);
      
      // Display tokens
      const tokens = anitomy.tokens();
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        console.log(`[1]         {`);
        console.log(`[1]             "category": "${token.category}",`);
        console.log(`[1]             "content": "${token.content}",`);
        console.log(`[1]             "enclosed": ${token.enclosed}`);
        console.log(`[1]         }${i < tokens.length - 1 ? ',' : ''}`);
      }
      
      console.log(`[1]     ]`);
      console.log(`[1] }`);
      
      // Additional test cases
      console.log('\n🧪 Additional Test Cases:');
      
      const additionalTests = [
        "Attack on Titan S04E28 1080p WEB-DL",
        "One Piece S01E1000 720p",
        "Demon Slayer 2x05 FINAL",
        "Naruto Shippuden S15E320"
      ];
      
      additionalTests.forEach((title, index) => {
        console.log(`\n[${index + 2}] Testing: "${title}"`);
        const anitomy2 = new anitomyModule.Anitomy();
        const result2 = anitomy2.parse(title);
        
        if (result2) {
          console.log(`[${index + 2}] ✅ Parsed successfully:`);
          console.log(`[${index + 2}]   - Anime Title: "${anitomy2.elements.get('anime_title') || 'N/A'}"`);
          console.log(`[${index + 2}]   - Episode Number: "${anitomy2.elements.get('episode_number') || 'N/A'}"`);
          console.log(`[${index + 2}]   - Season: "${anitomy2.elements.get('anime_season') || 'N/A'}"`);
          console.log(`[${index + 2}]   - Resolution: "${anitomy2.elements.get('video_resolution') || 'N/A'}"`);
        } else {
          console.log(`[${index + 2}] ❌ Failed to parse`);
        }
      });
      
    } else {
      console.log(`[1] ❌ Failed to parse the title`);
    }
    
  } catch (error) {
    console.error(`[1] ❌ Error during parsing:`, error);
  }
}

// Run the test
if (require.main === module) {
  testAnitomyParsing();
}

module.exports = { testAnitomyParsing };
