# Auto-Accept

## Problem

When Antigravity IDE's sub-agent executes tool calls (run a command, write a file, read a file outside workspace, open browser), the Language Server pauses with status `WAITING_FOR_USER`. Without accepting these, the cascade stalls forever.

## Solution

`lib/auto-accept.js` detects WAITING steps and builds the correct interaction payload for each step type, then sends it via `HandleCascadeUserInteraction`.

## Step Type Handling

### RUN_COMMAND

Approves shell command execution with the exact proposed command line.

```js
interaction.runCommand = {
    confirm: true,
    proposedCommandLine: cmd,
    submittedCommandLine: cmd,
};
```

### CODE_ACTION (file writes)

Grants file permission. Path is extracted with 3 fallback strategies:

1. `step.codeAction.targetFile` / `step.codeAction.filePath` (JSON API)
2. `step.metadata.toolCall.argumentsJson` → parse `TargetFile` / `AbsolutePath`
3. Binary protobuf field `25` / field `1` (URI extraction via regex)

```js
interaction.filePermission = {
    allow: true,
    scope: 'PERMISSION_SCOPE_ONCE',
    absolutePathUri: filePath,
};
```

### VIEW_FILE / LIST_DIRECTORY / SEARCH / READ_URL_CONTENT

Read-only operations. Always allowed.

Same `filePermission` payload with the source path/URI.

### SEND_COMMAND_INPUT

Confirms terminal input (stdin) with the proposed text.

```js
interaction.sendCommandInput = {
    confirm: true,
    proposedInput: input,
    submittedInput: input,
};
```

### BROWSER_SUBAGENT

Confirms browser automation actions.

```js
interaction.browserAction = { confirm: true };
```

### Unknown Types

Falls back to: try extract file path → `filePermission`, else `{ confirm: true }`.

## Debouncing

Each (cascadeId, stepIndex) pair is tracked to avoid double-accepting. Entries auto-expire after 15 seconds.

## Binary Protobuf Fallback

If status is `WAITING_FOR_USER` but JSON API returns no WAITING step (known LS bug with `startIndex`), falls back to `callApiBinary()` → `decodeBinarySteps()` to find the step.
