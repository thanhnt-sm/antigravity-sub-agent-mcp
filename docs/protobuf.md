# Binary Protobuf

## Why Binary?

Antigravity LS JSON API has a known bug: it may **ignore `startIndex`/`endIndex`** and return a capped number of steps (~598). This affects both macOS and Windows.

Binary protobuf requests (`Content-Type: application/proto`) correctly respect pagination parameters.

## Encoding

`encodeStepsRequest(cascadeId, startIndex, endIndex)` builds a raw protobuf buffer:

- Field 1 (string): cascadeId
- Field 2 (varint): startIndex
- Field 3 (varint): endIndex

## Decoding

`decodeBinarySteps(buf)` decodes the response into JSON-compatible step objects using hand-written field maps (no `.proto` file needed).

### Enum Maps

**Step Status** (field 4):

| Binary | JSON |
|---|---|
| 0 | UNSPECIFIED |
| 1 | PENDING |
| 2 | IN_PROGRESS |
| 3 | DONE |
| 4 | ERROR |
| 5 | CANCELLED |
| 7 | BLOCKED |
| 9 | WAITING |

**Step Type** (field 1):

| Binary | JSON |
|---|---|
| 5 | CODE_ACTION |
| 8 | VIEW_FILE |
| 9 | LIST_DIRECTORY |
| 21 | RUN_COMMAND |
| 81 | TASK_BOUNDARY |
| 82 | NOTIFY_USER |
| 85 | BROWSER_SUBAGENT |
| 100 | SEND_COMMAND_INPUT |
| ... | (20+ types total) |

### Content Field Map

Maps protobuf field numbers to JSON key names. Example: field 28 → `runCommand`, field 10 → `codeAction`.

### Nested Field Maps

Per-content-type field name mappings discovered by cross-referencing JSON and binary LS responses. Example:

```js
runCommand: {
    2: 'cwd',
    6: 'exitCode',
    13: 'commandId',
    23: 'commandLine',
    25: 'proposedCommandLine'
}
```

## Generic Decoder

`decodeGenericMessage()` handles unknown nested messages with heuristics:

- Varint (wire type 0) → number
- Length-delimited (wire type 2) → string if printable, else recurse as nested message
- Max recursion depth: 6
- `looksLikeString()` checks if >90% of bytes are printable UTF-8

## apiStartIndex Workaround

`detectApiStartIndex(stepsLength, expectedRange, requestedFrom)` detects when LS returned from index 0 instead of the requested start. If response contains more steps than the requested range, API started at 0.
