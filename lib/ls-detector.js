// @ts-nocheck — T24: Pending jsDoc migration (see types/index.d.ts)
// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Khanh Nguyen

// === Language Server Auto-Detection ===
// Ported from Antigravity-Deck/src/detector.js (ESM, simplified)
// Scans OS processes for Antigravity LS, finds ports, probes API.
// No Deck dependency — works standalone.

import { exec } from 'node:child_process';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const platform = os.platform(); // 'darwin', 'win32', 'linux'
const log = (m) => process.stderr.write(`[ls-detector] ${m}\n`);

// ── Step 1: Find LS processes ────────────────────────────────────────────────

export function detectLanguageServers() {
    return new Promise((resolve) => {
        let cmd;
        if (platform === 'win32') {
            const tmpScript = path.join(os.tmpdir(), '_ls_detect.ps1');
            fs.writeFileSync(tmpScript,
                "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server*' } | Select-Object ProcessId, CommandLine | Format-List\n"
            );
            const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            cmd = `"${ps}" -ExecutionPolicy Bypass -NoProfile -File "${tmpScript}"`;
        } else {
            cmd = `ps aux | grep 'language_server' | grep -v grep`;
        }

        exec(cmd, { timeout: 10000 }, (err, stdout) => {
            // macOS/Linux fallback: try 'csrf_token' if 'language_server' not found
            if (platform !== 'win32' && (err || !stdout.trim())) {
                exec(`ps aux | grep 'csrf_token' | grep -v grep`, { timeout: 10000 }, (err2, stdout2) => {
                    if (err2 || !stdout2.trim()) { resolve([]); return; }
                    resolve(parseProcessOutput(stdout2));
                });
                return;
            }
            if (err || !stdout.trim()) { resolve([]); return; }
            resolve(parseProcessOutput(stdout));
        });
    });
}

function parseProcessOutput(stdout) {
    const instances = [];
    if (platform === 'win32') {
        for (const block of stdout.split(/\r?\n\r?\n/)) {
            if (!block.trim()) continue;
            const pidMatch = block.match(/ProcessId\s*:\s*(\d+)/);
            const csrfMatch = block.match(/--csrf_token\s+([a-f0-9-]+)/);
            const wsMatch = block.match(/--workspace_id\s+(\S+)/);
            if (pidMatch && csrfMatch) {
                instances.push({ pid: pidMatch[1], csrfToken: csrfMatch[1], workspaceId: wsMatch?.[1] || null });
            }
        }
    } else {
        for (const line of stdout.split('\n')) {
            if (!line.trim()) continue;
            const pidMatch = line.match(/\S+\s+(\d+)/);
            const csrfMatch = line.match(/--csrf_token\s+([a-f0-9-]+)/);
            const wsMatch = line.match(/--workspace_id\s+(\S+)/);
            if (pidMatch && csrfMatch) {
                instances.push({ pid: pidMatch[1], csrfToken: csrfMatch[1], workspaceId: wsMatch?.[1] || null });
            }
        }
    }
    return instances;
}

// ── Step 2: Find listening ports for a PID ───────────────────────────────────

export function detectPorts(pid) {
    return new Promise((resolve) => {
        let cmd;
        if (platform === 'win32') {
            cmd = `netstat -ano`;
        } else {
            cmd = `lsof -iTCP -sTCP:LISTEN -P -n -p ${pid} 2>/dev/null`;
        }

        exec(cmd, { timeout: 5000 }, (err, stdout) => {
            if (err || !stdout.trim()) { resolve([]); return; }
            const ports = [];
            const pidStr = String(pid);
            for (const line of stdout.split('\n')) {
                if (!line.trim()) continue;
                if (platform === 'win32') {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 4 && parts[parts.length - 1] === pidStr) {
                        const port = parseInt(parts[1]?.split(':').pop(), 10);
                        if (!isNaN(port)) ports.push(port);
                    }
                } else {
                    const cols = line.trim().split(/\s+/);
                    if (cols.length >= 2 && cols[1] === pidStr) {
                        const m = line.match(/:(\d+)\s+\(LISTEN\)/);
                        if (m) ports.push(parseInt(m[1]));
                    }
                }
            }
            resolve([...new Set(ports)].sort((a, b) => a - b));
        });
    });
}

// ── Step 3: Probe ports for API (HTTPS first, then HTTP) ─────────────────────

export async function findApiPort(ports, csrfToken) {
    if (!ports?.length || !csrfToken) return null;
    const headers = {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrfToken,
    };

    for (const port of ports) {
        // Try HTTPS (LS typically uses self-signed cert)
        try {
            const agent = new https.Agent({ rejectUnauthorized: false });
            const res = await fetch(
                `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`,
                { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(3000), agent }
            );
            if (res.ok) return { port, useTls: true };
        } catch { }

        // Fallback: HTTP
        try {
            const res = await fetch(
                `http://localhost:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`,
                { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(3000) }
            );
            if (res.ok) return { port, useTls: false };
        } catch { }
    }
    return null;
}

// ── Workspace ID matching ────────────────────────────────────────────────────
// LS --workspace_id encoding: /Users/foo/my-project → file_Users_foo_my_project
// (slashes and hyphens become underscores, prefixed with "file_")

function pathToWorkspaceId(absPath) {
    if (!absPath) return null;
    const cleaned = absPath.replace(/\/+$/, '').replace(/^\//, '').replace(/[\/-]/g, '_');
    return 'file_' + cleaned;
}

function workspaceIdMatchesPath(workspaceId, targetPath) {
    if (!workspaceId || !targetPath) return false;
    const targetId = pathToWorkspaceId(targetPath);
    if (!targetId) return false;
    return workspaceId === targetId || workspaceId.startsWith(targetId + '_') || targetId.startsWith(workspaceId + '_');
}

// ── PPID-based detection ─────────────────────────────────────────────────────
// MCP server is spawned by a specific LS process. process.ppid IS that LS PID.
// Read parent's command line to extract csrf_token and workspace_id, then
// find the port that LS is listening on.

async function detectFromParentProcess() {
    const ppid = process.ppid;
    if (!ppid) return null;

    log(`Checking parent process (PPID=${ppid})...`);

    // Read parent's command line
    return new Promise((resolve) => {
        const cmd = platform === 'win32'
            ? `wmic process where ProcessId=${ppid} get CommandLine /format:list 2>nul`
            : `ps -p ${ppid} -o command= 2>/dev/null`;

        exec(cmd, { timeout: 5000 }, async (err, stdout) => {
            if (err || !stdout.trim()) {
                log(`Could not read parent command line`);
                resolve(null);
                return;
            }

            const csrfMatch = stdout.match(/--csrf_token\s+([a-f0-9-]+)/);
            const wsMatch = stdout.match(/--workspace_id\s+(\S+)/);

            if (!csrfMatch) {
                log(`Parent is not an LS process (no --csrf_token)`);
                resolve(null);
                return;
            }

            const csrfToken = csrfMatch[1];
            const workspaceId = wsMatch?.[1] || null;
            log(`Parent LS: csrf=${csrfToken.substring(0, 8)}... workspace=${workspaceId}`);

            // Find the port the parent LS is listening on
            const ports = await detectPorts(ppid);
            if (!ports.length) {
                log(`No listening ports found for parent LS`);
                resolve(null);
                return;
            }

            const result = await findApiPort(ports, csrfToken);
            if (result) {
                log(`✓ Parent LS API on port ${result.port} (TLS: ${result.useTls})`);
                resolve({
                    port: result.port,
                    csrfToken,
                    useTls: result.useTls,
                    pid: String(ppid),
                    workspaceId,
                });
            } else {
                log(`Could not probe parent LS API`);
                resolve(null);
            }
        });
    });
}

// ── Full detection (priority: PPID → workspace match → first valid) ──────────

export async function autoDetect(targetWorkspace = null) {
    // Priority 1: Detect from parent process (fastest, most accurate)
    const fromParent = await detectFromParentProcess();
    if (fromParent) {
        // If workspace is specified AND parent doesn't match, continue to full scan
        if (targetWorkspace && !workspaceIdMatchesPath(fromParent.workspaceId, targetWorkspace)) {
            log(`Parent LS workspace (${fromParent.workspaceId}) doesn't match target (${targetWorkspace}), scanning all...`);
        } else {
            return fromParent;
        }
    }

    // Priority 2: Full scan + workspace matching
    const instances = await detectLanguageServers();
    if (!instances.length) return null;

    const validInstances = [];
    for (const inst of instances) {
        const ports = await detectPorts(inst.pid);
        if (!ports.length) continue;

        const result = await findApiPort(ports, inst.csrfToken);
        if (result) {
            validInstances.push({
                port: result.port,
                csrfToken: inst.csrfToken,
                useTls: result.useTls,
                pid: inst.pid,
                workspaceId: inst.workspaceId,
            });
        }
    }

    if (!validInstances.length) return null;

    // Match by workspace path if provided
    if (targetWorkspace) {
        const targetId = pathToWorkspaceId(targetWorkspace);
        log(`Matching workspace: ${targetWorkspace} → ${targetId}`);
        log(`Found ${validInstances.length} LS instances: ${validInstances.map(i => i.workspaceId || 'unknown').join(', ')}`);

        for (const inst of validInstances) {
            if (workspaceIdMatchesPath(inst.workspaceId, targetWorkspace)) {
                log(`✓ Matched: ${inst.workspaceId} (port ${inst.port})`);
                return inst;
            }
        }
        log(`✗ No exact match, using first instance: ${validInstances[0].workspaceId}`);
    }

    return validInstances[0];
}
