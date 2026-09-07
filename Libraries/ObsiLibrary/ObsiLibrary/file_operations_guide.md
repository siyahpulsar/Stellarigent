# File and Folder Operations Guide
- Bir işlem yaparken cmd veya powershell komutları yerine tool kullanmaya özen göster. Yoksa komutların çalışmayabilir. Tool kullan. Toollar, aşşağıda belirtilmiştir.
Guidelines for managing, reading, writing, editing, and listing files and directories.
- Bir işlem yaparken cmd veya powershell komutları yerine tool kullanmaya özen göster. Yoksa komutların çalışmayabilir. Tool kullan. Toollar, aşşağıda belirtilmiştir.
## File and Directory Management Tools
- Bir işlem yaparken cmd veya powershell komutları yerine tool kullanmaya özen göster. Yoksa komutların çalışmayabilir. Tool kullan. Toollar, aşşağıda belirtilmiştir.


- {"action": "read_file", "path": "file_path", "explanation": "why"}
   -- Reads the contents of a local file.
- {"action": "write_file", "path": "file_path", "content": "text_content", "explanation": "why"}
   -- Writes content to a local file (overwriting it if it exists).
- {"action": "list_directory", "path": "dir_path", "explanation": "why"}
   -- Lists files and subfolders in a directory.
- {"action": "send_discord_message", "content": "text_message", "filePath": "optional_local_path_to_file", "explanation": "why"}
   -- Sends a text message and/or a local file/image attachment back to the Discord channel to communicate with the user.




- **read_file**
  - Reads the raw contents of a local file. Used to inspect configurations, source files, or read text content.

- **write_file**
  - Writes text content to a local file, creating the file and any parent directories if they do not exist. Note that this action completely overwrites existing files.

- **list_directory**
  - Lists all files and subfolders in a specific directory. Useful for exploring project structures and finding specific paths.

- **line_checker**
  - Filters lines in a specified local file, retaining only lines that match the query word and removing all others. Useful for quick cleanup of log files or narrowing down matching items.

- **execute_command**
  - Runs terminal commands (CMD or PowerShell). Can be used to create directories (`mkdir`), copy files (`cp` / `copy`), move files (`mv` / `move`), or delete files (`rm` / `del`) if native tools do not cover the requirement.

## Best Practices & Guidelines

- **Use Native Tools First**: Always prefer native tools like `write_file` or `read_file` instead of shell commands (like `echo > file` or `cat file`) for file creation and reading.
- **Paths**: Provide absolute paths or paths relative to the current working directory. Always verify paths using `list_directory` before attempting to read or overwrite.
- **Safety Overwriting**: When using `write_file`, remember it will overwrite existing content completely. Ensure you have read the file's current content or backed it up if you only need to modify a small portion.
- **Directory Verification**: Before writing files into nested directories, check if the directories exist or verify that `write_file` will create them correctly.
