// SPDX-License-Identifier: MIT
// Antigravity Sub-Agent MCP — Type Definitions
// T24: TypeScript gradual migration — shared types for JSDoc annotations

/**
 * Language Server connection configuration
 */
export interface LsConfig {
    port: number;
    csrfToken: string;
    useTls?: boolean;
    host?: string;
    /** Workspace URI or path for multi-workspace routing */
    workspaceId?: string;
}

/**
 * Detected Language Server info from auto-detection
 */
export interface DetectedLs extends LsConfig {
    pid: number;
}

/**
 * Cascade trajectory summary from getAllStatuses()
 */
export interface TrajectorySummary {
    stepCount?: number;
    status?: string;
    trajectoryId?: string;
}

/**
 * Response from getStatus()
 */
export interface CascadeStatus {
    stepCount: number;
    status: string | null;
    trajectoryId: string | null;
}

/**
 * A single step in a cascade trajectory
 */
export interface CascadeStep {
    type?: string;
    notifyUser?: {
        notificationContent?: string;
        askForUserFeedback?: boolean;
        isBlocking?: boolean;
    };
    plannerResponse?: {
        response?: string;
        modifiedResponse?: string;
    };
    taskBoundary?: {
        taskSummary?: string;
    };
}

/**
 * Options for waitForCompletion()
 */
export interface WaitOptions {
    timeoutMs?: number;
    maxReplies?: number;
    onProgress?: (info: ProgressInfo) => void;
}

/**
 * Progress callback payload
 */
export interface ProgressInfo {
    status: string;
    stepCount: number;
    autoReplies: number;
    elapsed: number;
}

/**
 * Result from waitForCompletion()
 */
export interface CompletionResult {
    ok: boolean;
    text: string;
    stepCount: number;
    stepType?: string;
}

/**
 * Auto-accept result
 */
export interface AutoAcceptResult {
    accepted: boolean;
    stepType?: string;
}

/**
 * Task registry entry for parallel orchestration
 */
export interface TaskEntry {
    cascadeId: string;
    promise: Promise<CompletionResult>;
    result: CompletionResult | null;
    status: string;
    taskName: string;
    model: string;
    startedAt: number;
}
