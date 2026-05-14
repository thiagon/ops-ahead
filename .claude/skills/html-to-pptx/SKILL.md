---
name: html-to-pptx
description: Converts HTML slide decks (.slide-container divs) to high-quality PPTX files. Use this skill when the user wants to export, convert, or generate a PowerPoint/PPTX from an HTML presentation — including phrases like "faz o pptx", "gera o pptx", "converte para powerpoint", "exporta como pptx", "transforma em apresentação", or any request to turn an HTML deck into a .pptx file. ALSO use proactively if the user just finished editing an HTML presentation and asks for a file to share.
compatibility:
  tools:
    - mcp__playwright__browser_run_code_unsafe
    - Bash
---

# HTML → PPTX

Renders each `.slide-container` from an HTML presentation at **2× resolution** (2560×1440) via Playwright and assembles them into a standard widescreen PPTX using python-pptx.

The bundled script is at `${CLAUDE_SKILL_DIR}/scripts/slides_to_pptx.py`.

## Prerequisites

- Playwright MCP must be connected (`mcp__playwright__browser_run_code_unsafe` available)
- HTML must be served via HTTP — VS Code Live Server (port 5500) or `python3 -m http.server <port>`
- `python-pptx` and `Pillow` installed (`uv pip install python-pptx pillow` or `pip install python-pptx pillow`)

## Step-by-step

### 1. Resolve inputs

If not already clear from context, ask:
- **HTML file path** — relative to project root, e.g. `docs/presentations/sprint-2.html`
- **HTTP port** — default `5500` (Live Server); if not running, ask user to start it
- **Output path** — default: same directory as HTML, same name with `.pptx` extension

Build the URL: `http://localhost:<port>/<relative-html-path>`

Set a temp directory for slide images:
```
SLIDES_DIR="<project-root>/.playwright-mcp/slides"
```
(already in `.playwright-mcp/`, which Playwright MCP is allowed to write to)

### 2. Capture all slides

Run this entire block in one `mcp__playwright__browser_run_code_unsafe` call:

```javascript
async (page) => {
  const outDir = '<SLIDES_DIR>';

  // Navigate and wait for all resources (fonts, images, icons)
  await page.goto('<URL>', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Inject CSS overrides — !important is required to beat the stylesheet
  // zoom: 2 renders at 2× without needing deviceScaleFactor
  await page.addStyleTag({ content: `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #0B0F19 !important;
      display: block !important;
      gap: 0 !important;
      overflow: hidden !important;
    }
    .slide-container {
      width: 1280px !important;
      height: 720px !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      margin: 0 !important;
      zoom: 2;
    }
  ` });

  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForTimeout(500);

  const count = await page.evaluate(
    () => document.querySelectorAll('.slide-container').length
  );

  for (let i = 0; i < count; i++) {
    // Show one slide at a time
    await page.evaluate((idx) => {
      document.querySelectorAll('.slide-container').forEach((el, j) => {
        el.style.display = j === idx ? 'flex' : 'none';
      });
    }, i);

    await page.waitForTimeout(200);

    const num = String(i + 1).padStart(2, '0');
    const slide = page.locator(`.slide-container:nth-child(${i + 1})`);
    await slide.screenshot({ path: `${outDir}/slide_${num}.png`, type: 'png' });
  }

  return `Captured ${count} slides → ${outDir}`;
}
```

**Why this works:**
- `waitUntil: 'networkidle'` ensures web fonts and images are fully loaded
- `!important` overrides the grid layout and spacing from the HTML stylesheet
- `zoom: 2` doubles the layout box to 2560×1440 so element screenshots are crisp
- Hiding all slides except the current one prevents overflow/clipping issues

### 3. Assemble the PPTX

```bash
uv run python <CLAUDE_SKILL_DIR>/scripts/slides_to_pptx.py <SLIDES_DIR> <OUTPUT_PATH>
# or
python <CLAUDE_SKILL_DIR>/scripts/slides_to_pptx.py <SLIDES_DIR> <OUTPUT_PATH>
```

### 4. Verify and report

Check the file was created and report the path. If the user's project has a `uv` venv, prefer `uv run python`.

## Edge cases

- **Server not running**: tell the user to open the HTML in VS Code and click "Go Live", or run `python3 -m http.server 5500` in the project root.
- **Slides use a different class**: if the HTML uses a class other than `.slide-container`, ask the user for the correct selector and substitute it throughout.
- **Font Awesome / Google Fonts not loading**: the 2-second `waitForTimeout` after navigation covers most cases. If icons show as boxes, increase to 3000ms.
- **Slides directory doesn't exist**: the Playwright MCP server writes to `.playwright-mcp/` automatically — no need to create it manually.
