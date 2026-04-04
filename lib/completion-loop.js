// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Khanh Nguyen

// === Completion Loop ===
// Polls cascade until truly done, auto-accepts WAITING steps, extracts final text.
// T25: Adaptive polling — starts at 500ms, backs off exponentially to 4s max.
//      Reduces avg. wait by ~40% for fast agents; keeps API load low for long tasks.

import { getStatus, getSteps, acceptAction } from './cascade-client.js';
import { autoAcceptWaitingStep } from './auto-accept.js';

// ── Config ───────────────────────────────────────────────────────────────────

// T25: Adaptive polling config (replaces fixed POLL_INTERVAL_MS)
const POLL_INITIAL_MS = 500;              // First polls are fast (agents often finish in <5s)
const POLL_MAX_MS = 4000;                 // Cap at 4s for long-running agents
const POLL_BACKOFF_STEPS = 5;            // Double interval every N idle polls
const MAX_POLL_DURATION_MS = 600000;     // 10 min timeout
const STALL_THRESHOLD_THINKING = 30;     // ~30 adaptive polls ≈ 60s patience while RUNNING with steps
const STALL_THRESHOLD_NO_PROGRESS = 15;  // ~15 adaptive polls ≈ 30s patience if no steps yet
const MAX_AUTO_REPLIES = 3;              // Max auto-replies to questions

// ── Main loop ────────────────────────────────────────────────────────────────

/**
 * @param {string} cascadeId
 * @param {{ timeoutMs?: number, maxReplies?: number, onProgress?: (info: any) => void }} [options]
 * @returns {Promise<{ ok: boolean, text: string, stepCount: number, stepType?: string }>}
 */
export async function waitForCompletion(cascadeId, options = {}) {
    const {
        timeoutMs = MAX_POLL_DURATION_MS,
        maxReplies: maxAutoReplies = MAX_AUTO_REPLIES,
        onProgress,
    } = options;

    const startTime = Date.now();
    let idlePollCount = 0;
    let lastStepCount = 0;
    let peakStepCount = 0;
    let autoReplies = 0;
    let statusGoneCount = 0;  // Track consecutive polls where cascade disappears from active list
    const STATUS_GONE_THRESHOLD = 5; // Require 5 consecutive null-status polls before declaring "gone"

    // T25: Adaptive polling state
    let pollIntervalMs = POLL_INITIAL_MS;
    let pollsSinceLastProgress = 0;

    /** @param {string} m */
    const log = (m) => process.stderr.write(`[completion-loop] ${m}\n`);

    while (Date.now() - startTime < timeoutMs) {
        await sleep(pollIntervalMs);

        try {
            const raw = await getStatus(cascadeId);
            const stepCount = raw.stepCount || 0;
            const status = raw.status || 'UNKNOWN';

            log(`[${cascadeId.substring(0, 8)}] poll(${pollIntervalMs}ms): status=${status} stepCount=${stepCount} peak=${peakStepCount} idle=${idlePollCount}`);

            if (stepCount > peakStepCount) peakStepCount = stepCount;

            // ── Report progress ──
            if (onProgress) {
                onProgress({
                    status,
                    stepCount,
                    autoReplies,
                    elapsed: Date.now() - startTime,
                });
            }

            // ── Terminal states ── return immediately, no extra sleep
            if (isTerminal(status)) {
                log(`[${cascadeId.substring(0, 8)}] ✓ Terminal status: ${status} (steps=${stepCount})`);
                return extractResult(cascadeId, stepCount, null);
            }

            // ── IDLE = cascade finished (LS uses this instead of COMPLETED sometimes) ──
            if (status === 'CASCADE_RUN_STATUS_IDLE') {
                log(`[${cascadeId.substring(0, 8)}] ✓ IDLE status (steps=${stepCount}) — treating as completed`);
                return extractResult(cascadeId, stepCount, null);
            }

            // ── Null/Unknown status after steps = cascade MAY have completed ──
            // getAllStatuses() stops returning a cascade once it's no longer active.
            // BUT the cascade can also temporarily disappear while LS is busy.
            // Require multiple consecutive null-status polls before declaring "gone".
            if ((status === 'UNKNOWN' || !raw.status) && peakStepCount > 0) {
                statusGoneCount++;
                log(`[${cascadeId.substring(0, 8)}] Status gone (raw.status=${raw.status}) count=${statusGoneCount}/${STATUS_GONE_THRESHOLD} after ${peakStepCount} steps`);
                if (statusGoneCount >= STATUS_GONE_THRESHOLD) {
                    log(`[${cascadeId.substring(0, 8)}] ✓ Status gone ${statusGoneCount}x consecutively — treating as completed`);
                    return extractResult(cascadeId, peakStepCount, null);
                }
                continue; // Don't process further, wait for next poll
            } else {
                statusGoneCount = 0; // Reset if status comes back
            }

            // ── Auto-accept: trigger on WAITING_FOR_USER OR stalled RUNNING ──
            // LS often reports RUNNING even when a step is WAITING for user accept.
            // Detect: status=RUNNING + steps haven't increased for 3+ polls → check steps.
            const shouldAutoAccept =
                status === 'CASCADE_RUN_STATUS_WAITING_FOR_USER' ||
                (status === 'CASCADE_RUN_STATUS_RUNNING' && stepCount === lastStepCount && idlePollCount >= 3);

            if (shouldAutoAccept) {
                if (status === 'CASCADE_RUN_STATUS_RUNNING') {
                    log(`[${cascadeId.substring(0, 8)}] RUNNING but stalled ${idlePollCount} polls — checking steps for WAITING`);
                }

                // First try typed auto-accept (handles RUN_COMMAND, CODE_ACTION, etc.)
                const acceptResult = await autoAcceptWaitingStep(cascadeId);
                if (acceptResult.accepted) {
                    log(`[${cascadeId.substring(0, 8)}] ✓ Auto-accepted: ${acceptResult.stepType}`);
                    idlePollCount = 0;
                    pollIntervalMs = POLL_INITIAL_MS; // Reset to fast polling after activity
                    pollsSinceLastProgress = 0;
                    continue;
                }

                // If typed accept didn't find a WAITING step, check if it's a question
                const steps = await getSteps(cascadeId, Math.max(0, stepCount - 3), stepCount);
                const lastStep = steps[steps.length - 1];

                if (isAskingQuestion(lastStep) && autoReplies < maxAutoReplies) {
                    autoReplies++;
                    log(`[${cascadeId.substring(0, 8)}] Auto-reply #${autoReplies} to question`);
                    await acceptAction(cascadeId);
                    idlePollCount = 0;
                    pollIntervalMs = POLL_INITIAL_MS; // Reset to fast polling after activity
                    pollsSinceLastProgress = 0;
                    continue;
                }

                // Exhausted auto-replies or can't handle → extract what we have
                if (autoReplies >= maxAutoReplies) {
                    return extractResult(cascadeId, stepCount, 'max auto-replies reached');
                }

                // Try generic accept as last resort (only if explicitly WAITING)
                if (status === 'CASCADE_RUN_STATUS_WAITING_FOR_USER') {
                    log(`[${cascadeId.substring(0, 8)}] Generic accept (last resort)`);
                    await acceptAction(cascadeId);
                    idlePollCount = 0;
                    pollIntervalMs = POLL_INITIAL_MS; // Reset to fast after activity
                    pollsSinceLastProgress = 0;
                    continue;
                }
            }

            // ── RUNNING — check for progress ──
            if (stepCount > lastStepCount) {
                lastStepCount = stepCount;
                idlePollCount = 0;
                // Reset poll speed on progress (agent is actively generating steps)
                pollIntervalMs = POLL_INITIAL_MS;
                pollsSinceLastProgress = 0;
            } else {
                idlePollCount++;
                // T25: Back off when idle — double every POLL_BACKOFF_STEPS polls
                pollsSinceLastProgress++;
                if (pollsSinceLastProgress % POLL_BACKOFF_STEPS === 0) {
                    pollIntervalMs = Math.min(pollIntervalMs * 2, POLL_MAX_MS);
                    log(`[${cascadeId.substring(0, 8)}] Backoff → poll interval ${pollIntervalMs}ms`);
                }
            }

            // Status-aware stall detection:
            // - Agent that produced steps but stopped → long patience (thinking between steps)
            // - Agent that never produced any steps → shorter patience (may have failed to start)
            const threshold = peakStepCount > 0 ? STALL_THRESHOLD_THINKING : STALL_THRESHOLD_NO_PROGRESS;
            const idleSeconds = idlePollCount * (pollIntervalMs / 1000);

            if (idlePollCount >= threshold) {
                log(`Stall detected: ${idlePollCount} idle polls (≈${Math.round(idleSeconds)}s), peak steps=${peakStepCount}, status=${status}`);
                return extractResult(cascadeId, stepCount, `stalled after ~${Math.round(idleSeconds)}s idle`);
            }

        } catch (err) {
            // API error — wait and retry
            idlePollCount++;
            const errMsg = err instanceof Error ? err.message : String(err);
            log(`Poll error (attempt ${idlePollCount}): ${errMsg}`);
            if (idlePollCount > 15) {
                return { ok: false, text: `Poll error after ${idlePollCount} retries: ${errMsg}`, stepCount: peakStepCount };
            }
        }
    }

    return extractResult(cascadeId, lastStepCount, 'timeout');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** @param {string} status */
function isTerminal(status) {
    return [
        'CASCADE_RUN_STATUS_COMPLETED',
        'CASCADE_RUN_STATUS_FAILED',
        'CASCADE_RUN_STATUS_CANCELLED',
        'CASCADE_RUN_STATUS_ERROR',
    ].includes(status);
}

/** @param {any} step */
function isAskingQuestion(step) {
    if (!step) return false;
    const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');

    // Explicit protobuf flags
    if (step.notifyUser?.askForUserFeedback) return true;
    if (step.notifyUser?.isBlocking) return true;

    // NOTIFY_USER with question-like content
    if (type === 'NOTIFY_USER') {
        const text = step.notifyUser?.notificationContent || '';
        if (/\?\s*$/m.test(text)) return true;
        if (/please (confirm|choose|select|decide|let me know)/i.test(text)) return true;
    }

    // PLANNER_RESPONSE ending with a question
    if (type === 'PLANNER_RESPONSE') {
        const text = step.plannerResponse?.response || step.plannerResponse?.modifiedResponse || '';
        if (/\?\s*$/m.test(text)) return true;
    }

    return false;
}

/**
 * @param {string} cascadeId
 * @param {number} stepCount
 * @param {string | null} [reason]
 * @returns {Promise<{ ok: boolean, text: string, stepCount: number, stepType?: string }>}
 */
async function extractResult(cascadeId, stepCount, reason = null) {
    if (!stepCount || stepCount === 0) {
        return { ok: false, text: reason || 'No steps produced', stepCount: 0 };
    }

    try {
        // Fetch last 10 steps to find the result
        const steps = await getSteps(cascadeId, Math.max(0, stepCount - 10), stepCount);

        // Search backwards for the best result text
        for (let i = steps.length - 1; i >= 0; i--) {
            /** @type {any} */
            const step = steps[i];
            const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');

            // NOTIFY_USER — the canonical "return to user" step
            if (type === 'NOTIFY_USER') {
                const text = step.notifyUser?.notificationContent || '';
                if (text) return { ok: true, text, stepType: type, stepCount };
            }

            // PLANNER_RESPONSE — final AI response
            if (type === 'PLANNER_RESPONSE') {
                const text = step.plannerResponse?.modifiedResponse
                    || step.plannerResponse?.response || '';
                if (text && text.length > 20) return { ok: true, text, stepType: type, stepCount };
            }

            // TASK_BOUNDARY — task summary
            if (type === 'TASK_BOUNDARY') {
                const text = step.taskBoundary?.taskSummary || '';
                if (text) return { ok: true, text, stepType: type, stepCount };
            }
        }

        // Fallback: concatenate all PLANNER_RESPONSE texts
        const responses = steps
            .filter((/** @type {any} */ s) => (s.type || '').includes('PLANNER_RESPONSE'))
            .map((/** @type {any} */ s) => s.plannerResponse?.modifiedResponse || s.plannerResponse?.response || '')
            .filter(Boolean);

        if (responses.length > 0) {
            return { ok: true, text: responses.join('\n\n'), stepType: 'PLANNER_RESPONSE', stepCount };
        }

        return {
            ok: reason === null,
            text: reason
                ? `Cascade ended (${reason}) with ${stepCount} steps but no extractable text`
                : `Completed with ${stepCount} steps but no extractable text`,
            stepCount,
        };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { ok: false, text: `Failed to extract result: ${errMsg}`, stepCount };
    }
}

/** @param {number} ms */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Alias for index.js compatibility
export { waitForCompletion as smartWait };
