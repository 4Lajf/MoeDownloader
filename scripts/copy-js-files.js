const fs = require('fs');
const path = require('path');

// Copy JavaScript files from electron source to dist
function copyJSFiles() {
  const sourceDir = path.join(__dirname, '../electron');
  const distDir = path.join(__dirname, '../dist/electron');

  // Ensure dist directory exists
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Copy services directory
  const servicesSource = path.join(sourceDir, 'services');
  const servicesDist = path.join(distDir, 'services');
  
  if (!fs.existsSync(servicesDist)) {
    fs.mkdirSync(servicesDist, { recursive: true });
  }

  // Copy all .js files from services
  if (fs.existsSync(servicesSource)) {
    const files = fs.readdirSync(servicesSource);
    files.forEach(file => {
      if (file.endsWith('.js')) {
        const sourcePath = path.join(servicesSource, file);
        const destPath = path.join(servicesDist, file);
        fs.copyFileSync(sourcePath, destPath);
        console.log(`Copied: ${file}`);
      }
    });
  }

  // Copy lib directory
  const libSource = path.join(sourceDir, 'lib');
  const libDist = path.join(distDir, 'lib');
  
  if (!fs.existsSync(libDist)) {
    fs.mkdirSync(libDist, { recursive: true });
  }

  // Copy all .js files from lib
  if (fs.existsSync(libSource)) {
    const files = fs.readdirSync(libSource);
    files.forEach(file => {
      if (file.endsWith('.js')) {
        const sourcePath = path.join(libSource, file);
        const destPath = path.join(libDist, file);
        fs.copyFileSync(sourcePath, destPath);
        console.log(`Copied: ${file}`);
      }
    });
  }
}

if (require.main === module) {
  copyJSFiles();
}

module.exports = { copyJSFiles };
