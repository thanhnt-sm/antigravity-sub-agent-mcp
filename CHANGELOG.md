# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-03-15

### Added

- **`submit_agent`** — non-blocking tool that spawns a sub-agent and returns a `taskId` instantly
- **`get_agent_results`** — batch-waits for multiple submitted tasks and returns all results together
- **Workspace auto-detection** — PPID-based detection, workspace path matching, and first-valid fallback
- **Auto-accept** — automatically handles WAITING steps (commands, file writes, browser actions, terminal input)
- **Stalled-running detection** — proactively checks for WAITING steps when RUNNING status stalls
- **Binary protobuf fallback** — correctly handles paginated step fetching when JSON API caps results
- **Model aliases** — friendly names for Gemini, Claude, and GPT models
- **stdio transport** — runs as a `command` in `mcp_config.json`, no manual server start needed

### Credits

- Ported and simplified from [Antigravity Deck](https://github.com/khanhbkqt/Antigravity-Deck)
