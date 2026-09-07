# Web Searching & Crawling Guide

Tips for clean information scanning and web crawling.

## Search Guidelines & Rules
- **Library Mode First**: Before conducting any web search, you must always attempt to retrieve information locally using the `library_mode` tool. Only proceed to a web search if the required information cannot be found in the local library.

## Query Tuning
- Exclude terms: `query -exclude`
- File type filters: `filetype:pdf`
- Site filters: `site:github.com`

## Search & Scraping Tool Notes
- **Web Search**: The default `web_search` tool queries Yahoo Search to avoid CAPTCHA blocks. If Yahoo Search fails or returns no organic results, it automatically falls back to DuckDuckGo Lite. It returns clean parsed URLs, titles, and snippets.
- **Dynamic Site Scraping (Puppeteer)**: The `view_website` tool uses a headless **Puppeteer** browser to scrape links. This allows it to dynamically render JavaScript on single-page apps (SPAs), wait for elements to load, and extract the fully-rendered body text.
- **Formatting**: Boilerplate elements like `<script>`, `<style>`, `<header>`, and `<nav>` are automatically stripped by the scraper to prevent context pollution. Outputs are capped at 8,000 characters.
