# Architecture

## Overview

The Sub-Agent MCP Server acts as a bridge between a main AI agent (Claude, Gemini, etc.) and Antigravity IDE's Language Server (LS). It exposes a single MCP tool `start_agent` that creates a new cascade, sends a task, auto-accepts all tool actions, and returns the final result.

## System Diagram

```
┌──────────────┐     stdio/MCP      ┌──────────────────────┐
│  Main Agent  │ ◄─────────────────► │  index.js            │
│  (Claude)    │                     │  MCP Server          │
└──────────────┘                     └──────┬───────────────┘
                                            │
                                            ▼
                                     ┌──────────────────────┐
                                     │  cascade-client.js   │
                                     │  HTTP Client         │
                                     └──────┬───────────────┘
                                            │ HTTP/HTTPS
                                            ▼
                                     ┌──────────────────────┐
                                     │  Antigravity LS      │
                                     │  (localhost:PORT)     │
                                     └──────────────────────┘
```

## Request Flow

1. Main agent calls `start_agent({ task: "..." })`
2. `index.js` auto-detects LS config via Antigravity Deck (`localhost:9807`)
3. Creates a new cascade via `StartCascade` RPC
4. Sends system prompt + task via `SendUserCascadeMessage` (streaming RPC)
5. `completion-loop.js` polls `GetAllCascadeTrajectories` every 1.5s
6. On `WAITING_FOR_USER`:
   - `auto-accept.js` fetches recent steps, finds the WAITING step
   - Builds a typed interaction payload based on step type
   - Sends via `HandleCascadeUserInteraction` (fire-and-forget RPC)
   - Falls back to binary protobuf if JSON API missed the step
7. On terminal status: extracts text from last PLANNER_RESPONSE or NOTIFY_USER step

## API Protocol

Antigravity LS uses the **Connect Protocol** (gRPC-compatible over HTTP):

- **JSON**: `Content-Type: application/json` + `Connect-Protocol-Version: 1`
- **Binary**: `Content-Type: application/proto` (for paginated step fetching)
- **Auth**: `X-Codeium-Csrf-Token` header
- **TLS**: Self-signed certificates (rejected unauthorized disabled)

## File Responsibilities

| File | Purpose |
|---|---|
| `index.js` | MCP server setup, tool registration, config bootstrap |
| `cascade-client.js` | All HTTP communication with LS |
| `completion-loop.js` | Poll orchestration, state machine, result extraction |
| `auto-accept.js` | WAITING step detection + interaction payload building |
| `protobuf.js` | Binary protobuf encoding/decoding with field maps |
