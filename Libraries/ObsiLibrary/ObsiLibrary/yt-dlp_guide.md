# YT-DLP Stream & Video Downloader Guide

Use `yt-dlp` to download video/audio streams safely.

## Key Commands
- Download best quality video/audio merged:
  `yt-dlp -f "bestvideo+bestaudio/best" --merge-output-format mp4 "URL"`
- Download extract audio only (MP3 320kbps):
  `yt-dlp -x --audio-format mp3 --audio-quality 0 "URL"`
- Download playlist:
  `yt-dlp --yes-playlist "URL"`
- Download subtitles:
  `yt-dlp --write-subs --sub-langs "en,tr" "URL"`
- Search videos:
  `yt-dlp "ytsearch5:[QUERY]" --flat-playlist --dump-json`  (but after the command, you must save the output to a file. and read.)