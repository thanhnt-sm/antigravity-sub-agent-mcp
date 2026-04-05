// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Khanh Nguyen

// === Cascade Client ===
// HTTP client for Antigravity Language Server API.
// Ported from Antigravity-Deck/src/api.js (ESM)
// Handles: startCascade, sendMessage, getStatus, getSteps, callApiBinary, callApiFireAndForget

import http from 'node:http';
import https from 'node:https';
import { encodeStepsRequest } from './protobuf.js';

// ── Connection ───────────────────────────────────────────────────────────────

/** @type {{ port: number, csrfToken: string, useTls: boolean, host: string } | null} */
let _config = null;

/**
 * @param {{ port: number, csrfToken: string, useTls?: boolean }} config
 * @returns {void}
 */
export function configure(config) {
    _config = {
        port: config.port,
        csrfToken: config.csrfToken,
        useTls: config.useTls ?? true,
        host: config.useTls ? '127.0.0.1' : 'localhost',
    };
    // Antigravity LS uses self-signed TLS certificates
    if (_config.useTls) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
}

/** @returns {boolean} */
export function isConfigured() {
    return _config !== null;
}

function conn() {
    if (!_config) throw new Error('Cascade client not configured. Call configure() first.');
    return _config;
}

// ── Low-level HTTP ───────────────────────────────────────────────────────────

/** @param {string} method @returns {string} */
function makeUrl(method) {
    const c = conn();
    return `${c.useTls ? 'https' : 'http'}://${c.host}:${c.port}/exa.language_server_pb.LanguageServerService/${method}`;
}

/** @returns {Record<string, string>} */
function baseHeaders() {
    const c = conn();
    return {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': c.csrfToken,
    };
}

// JSON RPC call (Connect Protocol)
/**
 * @param {string} method
 * @param {Record<string, unknown>} [body]
 * @returns {Promise<any>}
 */
async function callApi(method, body = {}) {
    const res = await fetch(makeUrl(method), {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`API ${method} returned ${res.status}`);
    return res.json();
}

// Fire-and-forget for streaming RPCs.
// HandleCascadeUserInteraction closes stream after processing.
// "socket hang up" / "ECONNRESET" are treated as SUCCESS.
/**
 * @param {string} method
 * @param {Record<string, unknown>} [body]
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: boolean, status: number, data?: string, error?: string}>}
 */
function callApiFireAndForget(method, body = {}, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const c = conn();
        const data = JSON.stringify(body);
        const transport = c.useTls ? https : http;
        const req = transport.request({
            hostname: c.host,
            port: c.port,
            path: `/exa.language_server_pb.LanguageServerService/${method}`,
            method: 'POST',
            headers: { ...baseHeaders(), 'Content-Length': Buffer.byteLength(data) },
            timeout: timeoutMs,
            rejectUnauthorized: false,
        }, (res) => {
            /** @type {any[]} */

            const chunks = [];
            res.on('data', c => chunks.push(c.toString()));
            res.on('end', () => resolve({ ok: (res.statusCode ?? 0) < 400, status: res.statusCode ?? 0, data: chunks.join('') }));
        });
        req.on('error', (/** @type {NodeJS.ErrnoException} */ e) => {
            if (e.code === 'ECONNRESET' || e.message?.includes('socket hang up')) {
                resolve({ ok: true, status: 0, data: 'stream_closed' });
            } else {
                resolve({ ok: false, status: 0, data: '', error: e instanceof Error ? e.message : String(e) });
            }
        });
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, data: '', error: 'timeout' }); });
        req.write(data);
        req.end();
    });
}

// Streaming RPC (for SendUserCascadeMessage etc)
/**
 * @param {string} method
 * @param {Record<string, unknown>} [body]
 * @param {number} [timeoutMs]
 * @returns {Promise<{status: number, data: string}>}
 */
function callApiStream(method, body = {}, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const c = conn();
        const data = JSON.stringify(body);
        const transport = c.useTls ? https : http;

        const req = transport.request({
            hostname: c.host,
            port: c.port,
            path: `/exa.language_server_pb.LanguageServerService/${method}`,
            method: 'POST',
            headers: { ...baseHeaders(), 'Content-Length': Buffer.byteLength(data) },
            timeout: timeoutMs,
            rejectUnauthorized: false,
        }, (res) => {
            /** @type {any[]} */

            const chunks = [];
            res.on('data', c => chunks.push(c.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, data: chunks.join('') }));
        });

        req.on('error', (/** @type {NodeJS.ErrnoException} */ e) => {
            // Stream close = LS processed request (normal for streaming RPCs)
            if (e.code === 'ECONNRESET' || e.message?.includes('socket hang up')) {
                resolve({ status: 0, data: 'stream_closed' });
            } else {
                reject(e);
            }
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Stream RPC timeout')); });
        req.write(data);
        req.end();
    });
}

// Binary Protobuf API call for paginated step fetching.
// Antigravity LS JSON API may ignore startIndex/endIndex and return a capped number of steps (~598).
// Binary protobuf requests (Content-Type: application/proto) correctly respect pagination.
/**
 * @param {string} cascadeId
 * @param {number} startIndex
 * @param {number} endIndex
 * @returns {Promise<Buffer>}
 */
export function callApiBinary(cascadeId, startIndex, endIndex) {
    return new Promise((resolve, reject) => {
        const c = conn();
        const body = encodeStepsRequest(cascadeId, startIndex, endIndex);
        const transport = c.useTls ? https : http;
        const req = transport.request({
            hostname: c.host,
            port: c.port,
            path: '/exa.language_server_pb.LanguageServerService/GetCascadeTrajectorySteps',
            method: 'POST',
            headers: {
                'Content-Type': 'application/proto',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': c.csrfToken,
                'Content-Length': body.length,
            },
            timeout: 30000,
            rejectUnauthorized: false,
        }, (res) => {
            /** @type {any[]} */

            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Binary RPC timeout')); });
        req.write(body);
        req.end();
    });
}

// ── Public API ───────────────────────────────────────────────────────────────

// Create a new cascade (conversation)
/** @returns {Promise<string>} cascadeId */
export async function startCascade() {
    const result = await callApi('StartCascade', {});
    return result.cascadeId;
}

// Send user message to cascade
/**
 * @param {string} cascadeId
 * @param {string} text
 * @param {string} [modelId]
 * @returns {Promise<{status: number, data: string}>}
 */
export async function sendMessage(cascadeId, text, modelId = 'MODEL_PLACEHOLDER_M26') {
    return callApiStream('SendUserCascadeMessage', {
        metadata: {},
        cascadeId,
        items: [{ text }],
        cascadeConfig: {
            plannerConfig: {
                plannerTypeConfig: { case: 'conversational', value: {} },
                planModel: modelId,
                requestedModel: { modelId },
            },
        },
    });
}

// Get all cascade statuses
/** @returns {Promise<{trajectorySummaries?: Record<string, import('../types/index.d.ts').TrajectorySummary>}>} */
export async function getAllStatuses() {
    return callApi('GetAllCascadeTrajectories', {});
}

// Get status + stepCount for a specific cascade
/** @param {string} m */
const _statusLog = (m) => process.stderr.write(`[cascade-client] ${m}\n`);

/**
 * @param {string} cascadeId
 * @returns {Promise<import('../types/index.d.ts').CascadeStatus>}
 */
export async function getStatus(cascadeId) {
    const summaries = await getAllStatuses();
    const shortId = cascadeId.substring(0, 8);
    const info = summaries?.trajectorySummaries?.[cascadeId];

    if (!info) {
        const keys = Object.keys(summaries?.trajectorySummaries || {}).map(k => k.substring(0, 8));
        _statusLog(`[${shortId}] NOT in trajectorySummaries (active cascades: [${keys.join(', ')}])`);
    }

    return {
        stepCount: info?.stepCount || 0,
        status: info?.status || null,
        trajectoryId: info?.trajectoryId || null,
    };
}

// Get steps from a cascade (JSON API)
/**
 * @param {string} cascadeId
 * @param {number} [startIndex]
 * @param {number} [endIndex]
 * @returns {Promise<any[]>}
 */
export async function getSteps(cascadeId, startIndex = 0, endIndex = 100) {
    const data = await callApi('GetCascadeTrajectorySteps', { cascadeId, startIndex, endIndex });
    return data.steps || [];
}

// Accept pending action via HandleCascadeUserInteraction
/**
 * @param {string} cascadeId
 * @param {Record<string, unknown>} interaction
 * @returns {Promise<{ok: boolean, status: number, data?: string}>}
 */
export async function handleInteraction(cascadeId, interaction) {
    return callApiFireAndForget('HandleCascadeUserInteraction', {
        cascadeId,
        interaction,
    });
}

// Simple accept (legacy — used for generic user feedback reply)
/**
 * @param {string} cascadeId
 * @returns {Promise<any>}
 */
export async function acceptAction(cascadeId) {
    return callApiStream('HandleCascadeUserInteraction', {
        cascadeId,
        userInteraction: { case: 'accept', value: {} },
    }, 10000).catch(() => ({ ok: true }));
}


