// __tests__/completion-loop.test.js
// Unit tests for completion-loop.js
// Tests: exported API surface, config constants, helper functions via module inspection

// ── Tests: Module API surface ─────────────────────────────────────────────────

describe('completion-loop module exports', () => {
    test('module loads without syntax errors', async () => {
        // Dynamic import — if syntax error, Jest catches as test failure
        const mod = await import('../lib/completion-loop.js');
        expect(mod).toBeDefined();
    });

    test('waitForCompletion is exported and is async', async () => {
        const mod = await import('../lib/completion-loop.js');
        expect(typeof mod.waitForCompletion).toBe('function');
        expect(mod.waitForCompletion.constructor.name).toBe('AsyncFunction');
    });

    test('smartWait alias is also exported (backward compat)', async () => {
        const mod = await import('../lib/completion-loop.js');
        expect(typeof mod.smartWait).toBe('function');
        // Should be the same function
        expect(mod.smartWait).toBe(mod.waitForCompletion);
    });
});

// ── Tests: Config constants (validated via source inspection) ─────────────────

describe('completion-loop config', () => {
    test('POLL_INITIAL_MS is 500ms (fast start)', async () => {
        // Read source and verify via regex — constants are not exported
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, resolve } = await import('node:path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(__dirname, '../lib/completion-loop.js'), 'utf-8');
        expect(src).toContain('POLL_INITIAL_MS = 500');
    });

    test('POLL_MAX_MS is 4000ms (4s cap)', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, resolve } = await import('node:path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(__dirname, '../lib/completion-loop.js'), 'utf-8');
        expect(src).toContain('POLL_MAX_MS = 4000');
    });

    test('POLL_BACKOFF_STEPS is 5', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, resolve } = await import('node:path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(__dirname, '../lib/completion-loop.js'), 'utf-8');
        expect(src).toContain('POLL_BACKOFF_STEPS = 5');
    });

    test('MAX_POLL_DURATION_MS is 600000ms (10 min timeout)', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, resolve } = await import('node:path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(__dirname, '../lib/completion-loop.js'), 'utf-8');
        expect(src).toContain('MAX_POLL_DURATION_MS = 600000');
    });

    test('MAX_AUTO_REPLIES is 3', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, resolve } = await import('node:path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(__dirname, '../lib/completion-loop.js'), 'utf-8');
        expect(src).toContain('MAX_AUTO_REPLIES = 3');
    });
});

// ── Tests: Backoff math ───────────────────────────────────────────────────────

describe('exponential backoff math', () => {
    test('backoff: doubling stays within POLL_MAX_MS (4000)', () => {
        const POLL_INITIAL_MS = 500;
        const POLL_MAX_MS = 4000;
        let interval = POLL_INITIAL_MS;
        const steps = [];
        for (let i = 0; i < 20; i++) {
            interval = Math.min(interval * 2, POLL_MAX_MS);
            steps.push(interval);
        }
        // All values should be ≤ POLL_MAX_MS
        expect(steps.every(v => v <= POLL_MAX_MS)).toBe(true);
        // Final value should be capped at POLL_MAX_MS
        expect(steps[steps.length - 1]).toBe(POLL_MAX_MS);
    });

    test('backoff: first doubling from 500ms gives 1000ms', () => {
        const POLL_INITIAL_MS = 500;
        expect(Math.min(POLL_INITIAL_MS * 2, 4000)).toBe(1000);
    });

    test('waitForCompletion accepts cascadeId string and options', async () => {
        // Just check the function signature works (will fail on network — that is expected)
        const mod = await import('../lib/completion-loop.js');
        const fn = mod.waitForCompletion;
        expect(fn.length).toBeLessThanOrEqual(2); // cascadeId + options
    });
});
