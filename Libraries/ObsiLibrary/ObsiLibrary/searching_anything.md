# Information Search & Retrieval Guide

A comprehensive guide on searching, filtering, and retrieving information locally and on the web.

## Search and Retrieval Tools

- **send_discord_message**
  - Sends a text message or a local file/image attachment back to the Discord channel to communicate with the user.

- **filter_output**
  - Filters the output text of the previously executed tool. It supports three filtering modes:
    - `line_match`: Returns only lines containing the query.
    - `url_extract`: Extracts a clean list of URLs.
    - `quote_extract`: Extracts text inside double quotes. This option is highly recommended and is the most stable and successful choice when searching for files or images on a website. Using other methods for file or image searches may result in errors or unexpected behavior.

- **url_image_reader**
  - Downloads selected URLs/images from the filtered output of `filter_output` and prompts the local LLM vision model to determine if they match the specified question. It returns the matching URL and stops at the first match. This tool must be used after executing `filter_output`.

- **line_checker**
  - Filters lines in a specified local file, retaining only the lines that contain the search query and removing the rest.

- **library_mode**
  - Activates the `MemoryLibrary` search mode. This tool temporarily clears the active message history to focus strictly on searching and reviewing documents inside the `MemoryLibrary` directory.

## Search Guidelines & Rules

- **Local First**: Always use the `library_mode` tool first when searching for information or solving a query. Local knowledge and documentation must be prioritized.
- **Web Search Fallback**: Only utilize the `web_search` tool if the required information cannot be located in the local files via `library_mode`.