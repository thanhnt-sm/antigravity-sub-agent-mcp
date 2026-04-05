// __tests__/sa-hook-executor-whitelist.test.js
// Security tests for sa-hook-executor path traversal guards
// Tests runHook() and runScript() whitelist validation

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Read source to verify guards are present ─────────────────────────────────

describe('sa-hook-executor: path traversal guard presence', () => {
    let src = '';

    beforeAll(() => {
        // __dirname = antigravity-sub-agent-mcp/__tests__/
        // sa-hook-executor is at: SuperAntigravity-Workspace/.agent/mcp/sa-hook-executor/index.js
        // Path from __tests__: ../../.agent/mcp/sa-hook-executor/index.js
        src = readFileSync(
            resolve(__dirname, '../../.agent/mcp/sa-hook-executor/index.js'),
            'utf-8'
        );
    });

    test('source contains path traversal guard for runHook()', () => {
        expect(src).toContain('startsWith(HOOKS_DIR');
    });

    test('source contains path traversal guard for runScript()', () => {
        expect(src).toContain('startsWith(SCRIPTS_DIR');
    });

    test('guard returns error object (not throw) on traversal', () => {
        expect(src).toContain("Path traversal blocked");
    });

    test('guard logs security event before returning error', () => {
        expect(src).toContain('[SECURITY] Path traversal blocked');
    });

    test('version is bumped to 1.0.1 after security fix', () => {
        expect(src).toContain("version: '1.0.1'");
    });
});

// ── Integration: verify guard logic with real path resolution ─────────────────

describe('sa-hook-executor: path resolution guard logic', () => {
    // __dirname = antigravity-sub-agent-mcp/__tests__/
    // workspace = antigravity-sub-agent-mcp/../  (2 levels up)
    const WORKSPACE = resolve(__dirname, '../../');
    const HOOKS_DIR = resolve(WORKSPACE, '.gemini', 'hooks');
    const SCRIPTS_DIR = resolve(WORKSPACE, '.agent', 'scripts');

    // Simulate the guard logic from runScript()
    function simulateRunScriptGuard(scriptName) {
        const shPath = resolve(SCRIPTS_DIR, scriptName);
        if (!shPath.startsWith(SCRIPTS_DIR + '/')) {
            return { error: `Path traversal blocked: ${shPath}` };
        }
        return { ok: true, resolvedPath: shPath };
    }

    // Simulate the guard logic from runHook()
    function simulateRunHookGuard(scriptBase) {
        const shPath = resolve(HOOKS_DIR, `${scriptBase}.sh`);
        if (!shPath.startsWith(HOOKS_DIR + '/')) {
            return { error: `Path traversal blocked: ${shPath}` };
        }
        return { ok: true, resolvedPath: shPath };
    }

    // ── runScript() tests ─────────────────────────────────────────────────────

    test('runScript: blocks ../../evil.sh traversal', () => {
        const result = simulateRunScriptGuard('../../evil.sh');
        expect(result.error).toContain('Path traversal blocked');
    });

    test('runScript: blocks ../escape.sh traversal', () => {
        const result = simulateRunScriptGuard('../escape.sh');
        expect(result.error).toContain('Path traversal blocked');
    });

    test('runScript: blocks absolute path injection', () => {
        const result = simulateRunScriptGuard('/tmp/malicious.sh');
        // resolve(SCRIPTS_DIR, '/tmp/malicious.sh') → '/tmp/malicious.sh'
        expect(result.error).toContain('Path traversal blocked');
    });

    test('runScript: allows valid script in SCRIPTS_DIR', () => {
        const result = simulateRunScriptGuard('convergence-enforcer.sh');
        expect(result.ok).toBe(true);
        expect(result.resolvedPath).toContain(SCRIPTS_DIR);
        expect(result.resolvedPath).not.toContain('..');
    });

    test('runScript: allows watchdog.sh', () => {
        const result = simulateRunScriptGuard('watchdog.sh');
        expect(result.ok).toBe(true);
    });

    test('runScript: allows mcp-health-check.sh', () => {
        const result = simulateRunScriptGuard('mcp-health-check.sh');
        expect(result.ok).toBe(true);
    });

    // ── runHook() tests ───────────────────────────────────────────────────────

    test('runHook: blocks ../../evil traversal', () => {
        const result = simulateRunHookGuard('../../etc/passwd');
        expect(result.error).toContain('Path traversal blocked');
    });

    test('runHook: blocks ../outside-hooks traversal', () => {
        const result = simulateRunHookGuard('../outside-hook');
        expect(result.error).toContain('Path traversal blocked');
    });

    test('runHook: allows legitimate hook (before-agent)', () => {
        const result = simulateRunHookGuard('before-agent');
        expect(result.ok).toBe(true);
        expect(result.resolvedPath).toContain(HOOKS_DIR);
    });

    test('runHook: allows after-agent hook', () => {
        const result = simulateRunHookGuard('after-agent');
        expect(result.ok).toBe(true);
    });

    test('runHook: allows session-start hook', () => {
        const result = simulateRunHookGuard('session-start');
        expect(result.ok).toBe(true);
    });
});
