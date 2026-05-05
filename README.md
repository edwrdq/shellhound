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

Install `uv` for Python scraper dependency management:

```sh
curl -LsSf https://astral.sh/uv | sh
```

The scraper's only required system dependency is `uv`.
The scraper environment is created automatically on first run. When
`scraper/.venv` is missing, Shellhound runs `uv sync` in `scraper/` before
launching the scraper.

Run the desktop app:

```sh
bun run tauri dev
```

Build the frontend:

```sh
bun run build
```

Run a scraper directly:

```sh
uv run --project scraper python scraper/crawler.py --seed "Civic Light Foundation" --scraper-type crawler --json
```

## Tauri Commands

- `read_entities()` reads `data/entities.json`
- `write_entities(data)` writes `data/entities.json`
- `read_relationships()` reads `data/relationships.json`
- `write_relationships(data)` writes `data/relationships.json`
- `read_financials()` reads `data/financials.json`
- `write_financials(data)` writes `data/financials.json`
- `run_scraper(seed, scraper_type)` invokes `scraper/crawler.py`
