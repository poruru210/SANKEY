const fs = require('fs');
const path = require('path');

const [inputDir, outputDir] = process.argv.slice(2);

if (!inputDir || !outputDir) {
    console.error('Usage: node afterBundling.js <inputDir> <outputDir>');
    process.exit(1);
}

// パス構築（OSに依存しない）
const src = path.join(inputDir, 'lambda', 'src', 'handlers', 'generators', 'template.gas.mustache');
const dest = path.join(outputDir, 'template.gas.mustache');

console.log(`[afterBundling.js] Copying file from:\n  ${src}\nto:\n  ${dest}`);

try {
    if (!fs.existsSync(src)) {
        console.error(`[afterBundling.js] ERROR: Source file not found at ${src}`);
        process.exit(1);
    }

    fs.copyFileSync(src, dest);

    if (!fs.existsSync(dest)) {
        console.error(`[afterBundling.js] ERROR: Destination file not found after copy`);
        process.exit(1);
    }

    console.log('[afterBundling.js] ✅ File copy successful.');
} catch (err) {
    console.error('[afterBundling.js] ❌ Error copying file:', err);
    process.exit(1);
}
