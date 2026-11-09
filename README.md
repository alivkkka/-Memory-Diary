# MemoryBook — Long-Term RP Memory for SillyTavern

**Development build 0.2.5 — functional sections.** Independent chat memory stored in the browser's IndexedDB.

## Install (development branch)

In SillyTavern: Extensions → Install extension → enter:

`https://github.com/alivkkka/-Memory-Diary/tree/memorybook-rebuild`

If SillyTavern's installer does not accept a branch URL, install the repository URL and select branch `memorybook-rebuild` if the installer offers a branch field.

## Important

- Each chat gets its own isolated memory book.
- Memory data is stored locally in IndexedDB, not in chat metadata.
- Existing `memory_book_v1` data is migrated into IndexedDB on first open.
- AI extraction uses the currently selected SillyTavern connection or the separately configured OpenAI-compatible endpoint.
- Export your chat before testing a development build.

## Current status

This is an early rebuild. The 0.2.5 update adds per-chat character profiles, pair-specific relationships, an RP timeline, an operation journal, and configurable API connection settings. It keeps the previous interface styling. Backups exclude API keys; imported backups are merged into the current chat book. Test the database migration and AI connection before relying on it for irreplaceable chats. Keep a backup of your chat.
