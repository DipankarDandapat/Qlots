const sharp = require('sharp');
const path = require('path');

const svg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1A4D35"/>
      <stop offset="1" stop-color="#0D2B1E"/>
    </linearGradient>
    <linearGradient id="line" x1="200" y1="700" x2="800" y2="200" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7ECBA1"/>
      <stop offset="1" stop-color="#C8E8A9"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="230" ry="230" fill="url(#bg)"/>
  <circle cx="512" cy="480" r="270" fill="none" stroke="#2A6B47" stroke-width="50"/>
  <polyline points="280,600 390,470 500,535 640,355 760,395" fill="none" stroke="url(#line)" stroke-width="50" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="640" cy="355" r="38" fill="#C8E8A9"/>
  <line x1="645" y1="625" x2="785" y2="765" stroke="#C8E8A9" stroke-width="56" stroke-linecap="round"/>
</svg>`;

const sizes = [
  { folder: 'mipmap-mdpi',    size: 48  },
  { folder: 'mipmap-hdpi',    size: 72  },
  { folder: 'mipmap-xhdpi',   size: 96  },
  { folder: 'mipmap-xxhdpi',  size: 144 },
  { folder: 'mipmap-xxxhdpi', size: 192 },
];

const resDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

(async () => {
  for (const { folder, size } of sizes) {
    const outPath = path.join(resDir, folder, 'ic_launcher.webp');
    const outRound = path.join(resDir, folder, 'ic_launcher_round.webp');
    await sharp(Buffer.from(svg)).resize(size, size).webp({ quality: 100 }).toFile(outPath);
    await sharp(Buffer.from(svg)).resize(size, size).webp({ quality: 100 }).toFile(outRound);
    console.log(`Generated ${folder} (${size}x${size})`);
  }
  console.log('All icons generated!');
})();
