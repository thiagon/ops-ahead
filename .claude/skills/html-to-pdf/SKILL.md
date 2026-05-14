---
name: html-to-pdf
description: Convert HTML slide decks to PDF at 1280×720 px (16:9), one slide per page. Use when the user asks to generate, export, or update a presentation PDF — including "faz o pdf", "gera o pdf", "atualiza o pdf", or any phrasing that implies turning an HTML presentation into a PDF file.
risk: safe
date_added: "2026-05-14"
---

# HTML to PDF

Converts HTML presentations (built with `.slide-container` divs) to 1280×720 px PDFs using Playwright and Chrome.

## Steps

1. Identify the target HTML file from the skill argument or the user's message. If neither provides one, ask the user which HTML file to convert before proceeding.

2. Get the skill's base directory from the `Base directory for this skill:` line at the top of this invocation. That path is where the script lives.

3. Run the script from the project root:
   ```bash
   CHROME_BIN=/usr/bin/google-chrome node "<base-dir>/scripts/html_to_pdf.js" <input.html>
   ```
   Replace `<base-dir>` with the actual path from step 2.

4. The PDF is written next to the HTML file (same name, `.pdf` extension) unless the user specifies a different output path.

## Requirements

- `google-chrome` — path via `CHROME_BIN` env var
- Node.js
- Playwright — the script tries local `node_modules`, then `PLAYWRIGHT_PATH`, then common global paths automatically

## Troubleshooting

- **Playwright not found** — install globally with `npm install -g playwright` or set `PLAYWRIGHT_PATH`.
- **Blank pages / missing images** — asset filenames referenced in the HTML must match files in the sibling `assets/` directory exactly (case-sensitive).
- **Wrong page size** — do not change `preferCSSPageSize: false` in the script.
