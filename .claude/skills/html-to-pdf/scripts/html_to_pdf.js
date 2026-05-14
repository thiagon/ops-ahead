#!/usr/bin/env node
// Converts an HTML slide deck to a 1280×720 PDF.
// Expects slides to use .slide-container divs and assets in an assets/ sibling dir.
//
// Usage:
//   node html_to_pdf.js <input.html> [output.pdf]
//
// Playwright resolution order:
//   1. local node_modules (project-level install)
//   2. PLAYWRIGHT_PATH env var
//   3. common global paths

const path = require('path');
const fs = require('fs');

function requirePlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_PATH,
    '/home/thiago/.nvm/versions/node/v22.22.0/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright',
  ].filter(Boolean);

  for (const p of candidates) {
    try { return require(p); } catch {}
  }
  throw new Error(
    'Playwright not found. Install it with `npm install -g playwright` or set PLAYWRIGHT_PATH.'
  );
}

const [,, htmlArg, pdfArg] = process.argv;
if (!htmlArg) {
  console.error('Usage: node html_to_pdf.js <input.html> [output.pdf]');
  process.exit(1);
}

const htmlPath = path.resolve(htmlArg);
const pdfPath = pdfArg ? path.resolve(pdfArg) : htmlPath.replace(/\.html$/, '.pdf');

const printCSS = `
  @page { size: 1280px 720px; margin: 0; }
  body { background: transparent !important; gap: 0 !important; padding: 0 !important; display: block !important; }
  .slide-container { width: 1280px !important; height: 720px !important; box-shadow: none !important; border-radius: 0 !important; page-break-after: always; break-after: page; margin: 0 !important; }
  .slide-container:last-child { page-break-after: auto; break-after: auto; }
`;

(async () => {
  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
  const page = await browser.newPage();

  let content = fs.readFileSync(htmlPath, 'utf8');

  // Inline all images under assets/ (recursive) as base64 to bypass file:// restrictions
  const assetDir = path.join(path.dirname(htmlPath), 'assets');
  const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };

  function inlineAssets(dir, relBase) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        inlineAssets(path.join(dir, entry.name), relPath);
      } else {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (!mimeMap[ext]) continue;
        const b64 = fs.readFileSync(path.join(dir, entry.name)).toString('base64');
        const dataUrl = `data:${mimeMap[ext]};base64,${b64}`;
        content = content.split(`assets/${relPath}`).join(dataUrl);
      }
    }
  }

  inlineAssets(assetDir, '');

  await page.setContent(content, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: printCSS });
  await page.pdf({
    path: pdfPath,
    width: '1280px',
    height: '720px',
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();
  console.log(`✓ ${pdfPath}`);
})();
