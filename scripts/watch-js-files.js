const fs = require('fs');
const path = require('path');
const { copyJSFiles } = require('./copy-js-files');

// Watch for changes in JavaScript files and copy them automatically
function watchJSFiles() {
  const sourceDir = path.join(__dirname, '../electron');
  
  console.log('Watching JavaScript files for changes...');
  
  // Initial copy
  copyJSFiles();
  
  // Watch services directory
  const servicesDir = path.join(sourceDir, 'services');
  if (fs.existsSync(servicesDir)) {
    fs.watch(servicesDir, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.js')) {
        console.log(`${eventType}: ${filename}`);
        copyJSFiles();
      }
    });
  }
  
  // Watch lib directory
  const libDir = path.join(sourceDir, 'lib');
  if (fs.existsSync(libDir)) {
    fs.watch(libDir, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.js')) {
        console.log(`${eventType}: ${filename}`);
        copyJSFiles();
      }
    });
  }
}

if (require.main === module) {
  watchJSFiles();
}

module.exports = { watchJSFiles };
