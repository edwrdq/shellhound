# Shellhound

---
readme written by claude because i got an article to write
---

Tauri v2 desktop app for nonprofit and corporate relationship investigations.

## Stack

- React + Vite + Tailwind in `src/`
- Cytoscape.js network graph visualization
- Tauri v2 Rust commands in `src-tauri/`
- Scrapling-based Python scrapers in `scraper/`
- JSON data files in `data/`

## Development

Install frontend dependencies:

```sh
bun install
```

Install scraper dependencies:

```sh
python3 -m pip install -r scraper/requirements.txt
```

Run the desktop app:

```sh
bun run tauri dev
```

On Linux, Tauri also needs native WebKitGTK development packages. On Debian or
Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Build the frontend:

```sh
bun run build
```

Run a scraper directly:

```sh
python3 scraper/crawler.py --seed "Civic Light Foundation" --scraper-type crawler --json
```

## Tauri Commands

- `read_entities()` reads `data/entities.json`
- `write_entities(data)` writes `data/entities.json`
- `read_relationships()` reads `data/relationships.json`
- `write_relationships(data)` writes `data/relationships.json`
- `read_financials()` reads `data/financials.json`
- `write_financials(data)` writes `data/financials.json`
- `run_scraper(seed, scraper_type)` invokes `scraper/crawler.py`
