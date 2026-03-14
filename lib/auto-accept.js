// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Khanh Nguyen

// === Auto-Accept Logic ===
// Ported from Antigravity-Deck/src/auto-accept.js (ESM, simplified for sub-agent)
// Builds interaction payloads for WAITING steps and auto-accepts them.
// Removed: workspace validation, settings persistence, broadcast, push-service, Discord relay.
// Sub-agent context: accept EVERYTHING — the main agent delegated full authority.

import { handleInteraction, getStatus, getSteps, callApiBinary } from './cascade-client.js';
import { decodeBinarySteps } from './protobuf.js';

function log(msg) { process.stderr.write(`[auto-accept] ${msg}\n`); }

// ── Debounce ─────────────────────────────────────────────────────────────────

const autoAcceptedSet = new Set();

function debounceKey(cascadeId, stepIndex) {
    return `${cascadeId}:${stepIndex}`;
}

// ── Build interaction payload from WAITING step data ─────────────────────────

export function buildInteraction(trajectoryId, stepIndex, step) {
    if (!trajectoryId || stepIndex === undefined || !step) return null;

    const interaction = { trajectoryId, stepIndex };
    const stepType = (step.type || '').replace('CORTEX_STEP_TYPE_', '');

    switch (stepType) {
        case 'RUN_COMMAND': {
            const cmd = step.runCommand?.commandLine || step.runCommand?.command || '';
            interaction.runCommand = {
                confirm: true,
                proposedCommandLine: cmd,
                submittedCommandLine: cmd,
            };
            break;
        }
        case 'CODE_ACTION': {
            let filePath = step.codeAction?.targetFile || step.codeAction?.filePath || '';
            // Fallback: check metadata.toolCall.argumentsJson for TargetFile
            if (!filePath && step.metadata?.toolCall?.argumentsJson) {
                try {
                    const args = JSON.parse(step.metadata.toolCall.argumentsJson);
                    filePath = args.TargetFile || args.AbsolutePath || args.FilePath || '';
                } catch { }
            }
            // Fallback: extract from binary-decoded codeAction numeric fields
            if (!filePath && step.codeAction) {
                const ca = step.codeAction;
                if (ca['25'] && typeof ca['25'] === 'string') {
                    const cleaned = ca['25'].replace(/[\x00-\x1f]/g, '').trim();
                    const winMatch = cleaned.match(/([A-Za-z]:\\[^\x00]+)/);
                    const macMatch = cleaned.match(/(\/[^\x00]+)/);
                    if (winMatch) filePath = winMatch[1];
                    else if (macMatch) filePath = macMatch[1];
                }
                if (!filePath && ca['1'] && typeof ca['1'] === 'string') {
                    const uriMatch = ca['1'].match(/file:\/\/(\/[^\s\x00]+)/);
                    if (uriMatch) {
                        let extracted = uriMatch[1];
                        if (/^\/[A-Za-z]:/.test(extracted)) extracted = extracted.substring(1);
                        filePath = 'file://' + (extracted.startsWith('/') ? '' : '/') + extracted;
                    }
                }
            }
            if (filePath) {
                // Sub-agent: always accept (no workspace validation needed)
                interaction.filePermission = {
                    allow: true,
                    scope: 'PERMISSION_SCOPE_ONCE',
                    absolutePathUri: filePath,
                };
            } else {
                interaction.codeAction = { confirm: true };
            }
            break;
        }
        case 'VIEW_FILE':
        case 'LIST_DIRECTORY':
        case 'READ_URL_CONTENT':
        case 'VIEW_CONTENT_CHUNK':
        case 'SEARCH': {
            // Read-only operations — always safe
            let readPath = '';
            if (step.viewFile?.absolutePathUri) readPath = step.viewFile.absolutePathUri;
            else if (step.viewFile?.filePermissionRequest?.absolutePathUri) readPath = step.viewFile.filePermissionRequest.absolutePathUri;
            else if (step.listDirectory?.directoryPathUri) readPath = step.listDirectory.directoryPathUri;
            if (!readPath && step.metadata?.toolCall?.argumentsJson) {
                try {
                    const args = JSON.parse(step.metadata.toolCall.argumentsJson);
                    readPath = args.AbsolutePath || args.DirectoryPath || args.SearchPath || args.Url || '';
                } catch { }
            }
            if (readPath) {
                let uri = readPath;
                if (!uri.startsWith('file://')) {
                    const normalized = uri.replace(/\\/g, '/');
                    uri = 'file:///' + (normalized.startsWith('/') ? normalized.substring(1) : normalized);
                }
                interaction.filePermission = {
                    allow: true,
                    scope: 'PERMISSION_SCOPE_ONCE',
                    absolutePathUri: uri,
                };
            } else {
                interaction.confirm = true;
            }
            break;
        }
        case 'SEND_COMMAND_INPUT': {
            const input = step.sendCommandInput?.input || '';
            interaction.sendCommandInput = {
                confirm: true,
                proposedInput: input,
                submittedInput: input,
            };
            break;
        }
        case 'OPEN_BROWSER_URL':
        case 'BROWSER_ACTION':
        case 'BROWSER_SUBAGENT': {
            interaction.browserAction = { confirm: true };
            break;
        }
        default: {
            // Unknown step type — try to find file path from various sources
            let fp = step.codeAction?.targetFile || step.codeAction?.filePath || '';
            if (!fp && step.metadata?.toolCall?.argumentsJson) {
                try {
                    const args = JSON.parse(step.metadata.toolCall.argumentsJson);
                    fp = args.TargetFile || args.AbsolutePath || args.FilePath || '';
                } catch { }
            }
            if (fp) {
                interaction.filePermission = {
                    allow: true,
                    scope: 'PERMISSION_SCOPE_ONCE',
                    absolutePathUri: fp,
                };
            } else {
                interaction.confirm = true;
            }
            break;
        }
    }

    return interaction;
}

// ── Antigravity LS API startIndex workaround ─────────────────────────────────
// LS JSON API may ignore startIndex and return from 0.
// Detect: if we got more steps than the requested range, API started at 0.
export function detectApiStartIndex(stepsLength, expectedRange, requestedFrom) {
    return stepsLength > expectedRange ? 0 : requestedFrom;
}

// ── Auto-accept a WAITING step ───────────────────────────────────────────────

export async function autoAcceptWaitingStep(cascadeId) {
    const { stepCount, status, trajectoryId } = await getStatus(cascadeId);

    // Use trajectoryId if available, cascadeId as fallback
    const effectiveTrajectoryId = trajectoryId || cascadeId;

    if (stepCount === 0) {
        log(`[${cascadeId.substring(0,8)}] No steps yet, skipping auto-accept`);
        return { accepted: false, reason: 'no steps' };
    }
    
    // Only process if RUNNING or WAITING_FOR_USER
    if (status !== 'CASCADE_RUN_STATUS_WAITING_FOR_USER' && status !== 'CASCADE_RUN_STATUS_RUNNING') {
        log(`[${cascadeId.substring(0,8)}] Status ${status} not actionable, skipping`);
        return { accepted: false, reason: `status=${status}` };
    }

    log(`Checking ${cascadeId.substring(0, 8)}: status=${status}, stepCount=${stepCount}, trajectoryId=${trajectoryId?.substring(0, 8) || 'NULL→using cascadeId'}`);


    // Fetch recent steps
    const from = Math.max(0, stepCount - 5);
    const steps = await getSteps(cascadeId, from, stepCount);

    const expectedRange = stepCount - from;
    const apiStartedAt = detectApiStartIndex(steps.length, expectedRange, from);
    log(`Fetched ${steps.length} steps (requested ${from}-${stepCount}, apiStartedAt=${apiStartedAt})`);

    // Search from end for WAITING step
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        const stepType = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
        log(`  step[${apiStartedAt + i}] type=${stepType} status=${step.status}`);

        if (step.status === 'CORTEX_STEP_STATUS_WAITING' || step.status === 9) {
            const stepIndex = apiStartedAt + i;
            const key = debounceKey(cascadeId, stepIndex);
            if (autoAcceptedSet.has(key)) {
                log(`  → Already accepted (debounced), skipping`);
                continue;
            }

            const interaction = buildInteraction(effectiveTrajectoryId, stepIndex, step);
            if (!interaction) {
                log(`  → buildInteraction returned null`);
                continue;
            }

            log(`  → Built interaction: ${JSON.stringify(interaction).substring(0, 200)}`);

            autoAcceptedSet.add(key);
            setTimeout(() => autoAcceptedSet.delete(key), 15000);

            const result = await handleInteraction(cascadeId, interaction);
            log(`  → handleInteraction result: ok=${result.ok} status=${result.status} data=${(result.data || result.error || '').substring(0, 100)}`);

            if (result.ok) {
                return { accepted: true, stepIndex, stepType };
            } else {
                autoAcceptedSet.delete(key);
                return { accepted: false, reason: `interaction failed: ${result.error || result.data}`, stepType };
            }
        }
    }

    // Binary fallback: if JSON didn't return the WAITING step
    if (status === 'CASCADE_RUN_STATUS_WAITING_FOR_USER') {
        log(`JSON didn't find WAITING step, trying binary fallback...`);
        try {
            const binBuf = await callApiBinary(cascadeId, from, stepCount);
            const decoded = decodeBinarySteps(binBuf);
            log(`Binary fallback: decoded ${decoded.length} steps`);
            for (let i = decoded.length - 1; i >= 0; i--) {
                const step = decoded[i];
                const stepType = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
                log(`  bin step[${from + i}] type=${stepType} status=${step.status}`);

                if (step.status === 'CORTEX_STEP_STATUS_WAITING' || step.status === 9) {
                    const stepIndex = from + i;
                    const key = debounceKey(cascadeId, stepIndex);
                    if (autoAcceptedSet.has(key)) {
                        log(`  → Already accepted (debounced), skipping`);
                        continue;
                    }

                    const interaction = buildInteraction(effectiveTrajectoryId, stepIndex, step);
                    if (!interaction) {
                        log(`  → buildInteraction returned null (binary)`);
                        continue;
                    }

                    log(`  → Built interaction (binary): ${JSON.stringify(interaction).substring(0, 200)}`);

                    autoAcceptedSet.add(key);
                    setTimeout(() => autoAcceptedSet.delete(key), 15000);

                    const result = await handleInteraction(cascadeId, interaction);
                    log(`  → handleInteraction result: ok=${result.ok}`);

                    if (result.ok) {
                        return { accepted: true, stepIndex, stepType, binary: true };
                    } else {
                        autoAcceptedSet.delete(key);
                        return { accepted: false, reason: `binary interaction failed`, stepType };
                    }
                }
            }
        } catch (e) {
            log(`Binary fallback error: ${e.message}`);
        }
    }

    log(`No WAITING step found in ${steps.length} steps`);
    return { accepted: false, reason: 'no WAITING step found' };
}
