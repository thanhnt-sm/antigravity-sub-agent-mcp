# Antigravity Sub-Agent MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)

An MCP server that lets a main AI agent spawn sub-agents on Antigravity IDE. Delegates tasks with full lifecycle management: creating cascades, auto-accepting tool actions, and extracting results.

Runs via **stdio** transport — configure as a `command` in `mcp_config.json`, no manual server start needed.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [MCP Tools](#mcp-tools)
- [Model Aliases](#model-aliases)
- [Key Features](#key-features)
- [Debugging](#debugging)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

## How It Works

```
Main Agent (Claude/Gemini/etc)
  ↓ MCP tool call
  ↓
index.js (stdio MCP server)
  ↓ autoDetect(workspace) → finds correct LS instance
  ↓ startCascade() → sendMessage(SYSTEM_PROMPT + task)
  ↓
completion-loop.js (polls until done)
  ├─ RUNNING → keep polling (auto-accept if steps stall)
  ├─ WAITING_FOR_USER → auto-accept.js handles it
  ├─ IDLE → treat as completed
  ├─ Question detected → auto-reply "proceed" (max 3)
  └─ COMPLETED → extract final text
  ↓
Returns result to Main Agent
```

## Project Structure

```
antigravity-sub-agent-mcp/
├── package.json
├── index.js                  # stdio MCP server (2 tools)
├── lib/
│   ├── ls-detector.js        # LS auto-detection (PPID + process scan + workspace matching)
│   ├── cascade-client.js     # HTTP client for LS API (JSON + binary + streaming)
│   ├── completion-loop.js    # Smart polling with auto-accept integration
│   ├── auto-accept.js        # Interaction payload builder for WAITING steps
│   └── protobuf.js           # Binary protobuf encoder/decoder
├── docs/                     # Internal architecture documentation
├── LICENSE                   # MIT License
├── CONTRIBUTING.md           # Contribution guide
├── CODE_OF_CONDUCT.md        # Contributor Covenant
└── CHANGELOG.md              # Release history
```

## Setup

### Prerequisites

- Node.js 18+
- Antigravity IDE running with at least one workspace open

### Install

```bash
cd antigravity-sub-agent-mcp
npm install
```

### Configure Antigravity

Add to your `mcp_config.json`:

```json
{
  "mcpServers": {
    "antigravity-sub-agent": {
      "command": "node",
      "args": ["/absolute/path/to/antigravity-sub-agent-mcp/index.js"]
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTIGRAVITY_PORT` | auto-detect | Language Server port |
| `ANTIGRAVITY_CSRF` | auto-detect | CSRF token |
| `ANTIGRAVITY_TLS` | `true` | Use TLS |

When not set, the server auto-detects the correct LS instance (see [Workspace Detection](#workspace-detection) below).

## MCP Tools

### `submit_agent` — Non-blocking

Submit a task and get a `taskId` back **immediately** (~1s). The sub-agent runs in the background.

Same params as `start_agent`. Returns `taskId` for use with `get_agent_results`.

---

### `get_agent_results` — Batch Wait

Wait for multiple submitted tasks and return all results at once.

| Param | Type | Required | Description |
|---|---|---|---|
| `taskIds` | string[] | ✅ | Array of taskIds from `submit_agent` calls |

**Parallel workflow:**

```
submit_agent(task1) → taskId: "abc"     ← instant
submit_agent(task2) → taskId: "def"     ← instant
submit_agent(task3) → taskId: "ghi"     ← instant
get_agent_results(["abc", "def", "ghi"]) → all 3 results (ran in parallel!)
```

## Model Aliases

| Alias | Model |
|---|---|
| `gemini-high` *(default)* | Gemini 3.1 Pro (High) |
| `gemini-low` | Gemini 3.1 Pro (Low) |
| `gemini-flash` | Gemini 3 Flash |
| `claude-sonnet` | Claude Sonnet 4.6 (Thinking) |
| `claude-opus` | Claude Opus 4.6 (Thinking) |
| `gpt-120b` | GPT-OSS 120B (Medium) |

Raw `MODEL_*` IDs also accepted.

## Key Features

### Workspace Detection

Auto-finds the correct LS instance:

1. **PPID detection** (primary): Parent process IS the LS — reads `--csrf_token` and `--workspace_id` from its command line
2. **Workspace path matching** (fallback): Matches `workspace` param against running LS instances
3. **First valid instance** (last resort): Uses whatever is available

### Auto-Accept

Handles all WAITING steps automatically:

- **Commands**: Approves with the exact proposed command line
- **File writes**: Grants file permission with the target path
- **File reads**: Always allows (read-only)
- **Browser actions**: Approves browser automation
- **Terminal input**: Confirms with proposed input

### Stalled-Running Detection

LS sometimes reports `RUNNING` status even when steps are waiting for user accept. The server detects stalled polls (steps not increasing) and proactively checks for WAITING steps to auto-accept.

### Binary Protobuf Fallback

When LS JSON API returns capped results, falls back to binary protobuf which correctly respects pagination.

## Debugging

All logs go to **stderr**:

```
[ls-detector] ✓ Parent LS API on port 53525 (TLS: false)
[sub-agent:abc12345] RUNNING steps=5 replies=0 elapsed=12s
[auto-accept]   → Built interaction: {"runCommand":{"commandLine":"npm test"}}
[auto-accept]   → handleInteraction result: ok=true
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## Acknowledgments

This project was built on top of and heavily inspired by [**Antigravity Deck**](https://github.com/thanhnt-sm/Antigravity-Deck) — the original toolkit for automating Antigravity IDE workflows.

Key components ported and simplified from Antigravity Deck:

- **Cascade Client** (`lib/cascade-client.js`) — HTTP client for Language Server API
- **Auto-Accept** (`lib/auto-accept.js`) — interaction payload builder for WAITING steps
- **LS Detector** (`lib/ls-detector.js`) — Language Server process auto-detection
- **Protobuf** (`lib/protobuf.js`) — binary protobuf encoder/decoder

Special thanks to the **Antigravity IDE** team for building the platform that makes this kind of agent orchestration possible.

## License

This project is licensed under the [MIT License](LICENSE).
