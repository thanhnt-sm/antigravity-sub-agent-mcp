# Cascade Client API

## Configuration

```js
import { configure, autoDetectConfig } from './lib/cascade-client.js';

// Auto-detect from Antigravity Deck
const config = await autoDetectConfig();
configure(config);

// Or manual
configure({ port: 13337, csrfToken: 'abc123', useTls: true });
```

## Functions

### `startCascade() → string`

Creates a new cascade (conversation). Returns `cascadeId`.

### `sendMessage(cascadeId, text, modelId?) → { status, data }`

Sends a user message via streaming RPC `SendUserCascadeMessage`. Returns when the stream closes (LS starts processing).

### `getAllStatuses() → object`

Returns all cascade trajectory summaries. Response shape:

```js
{
    trajectorySummaries: {
        "cascade-id-1": { stepCount: 42, status: "CASCADE_RUN_STATUS_COMPLETED", trajectoryId: "..." },
        ...
    }
}
```

### `getStatus(cascadeId) → { stepCount, status, trajectoryId }`

Convenience wrapper that extracts info for a specific cascade.

### `getSteps(cascadeId, startIndex, endIndex) → Step[]`

Fetches steps via JSON API. Known limitation: may ignore `startIndex`.

### `callApiBinary(cascadeId, startIndex, endIndex) → Buffer`

Fetches steps via binary protobuf. Correctly respects pagination. Returns raw buffer — decode with `decodeBinarySteps()`.

### `handleInteraction(cascadeId, interaction) → { ok, status?, data?, error? }`

Sends a typed interaction payload via fire-and-forget `HandleCascadeUserInteraction`. Used by auto-accept. Stream close / ECONNRESET = success.

### `acceptAction(cascadeId) → { ok }`

Simple generic accept (legacy). Used as last-resort fallback.

### `autoDetectConfig(deckUrl?) → config | null`

Fetches LS config from Antigravity Deck's `/api/instances` endpoint. Returns `{ port, csrfToken, useTls }` or null.

## Transport Methods

| Method | Use Case | Error Handling |
|---|---|---|
| `callApi` | Standard JSON RPC | Throws on non-2xx |
| `callApiStream` | Streaming RPCs (SendMessage) | ECONNRESET = success |
| `callApiFireAndForget` | HandleInteraction | ECONNRESET = success, timeout = 3s |
| `callApiBinary` | Paginated step fetch | Throws on error/timeout |
