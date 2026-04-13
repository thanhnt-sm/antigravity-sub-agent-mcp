// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Khanh Nguyen

/**
 * A Bounded Async Queue to limit concurrent dispatch and prevent IDE HTTP timeouts.
 * Bounded protection against E_MCP_FETCH dropping on Fan-Out dispatch pattern.
 */
export class AsyncQueue {
    constructor(limit = 1, timeoutMs = 60000, maxQueueSize = 50) {
        this.limit = limit;
        this.timeoutMs = timeoutMs;
        this.maxSize = maxQueueSize;
        this.running = 0;
        this.queue = [];
    }

    /**
     * Enqueues a task and returns a Promise resolving to its result.
     * @param {function(): Promise<any>} taskFn
     * @param {string} taskId For logging and timeouts
     * @returns {Promise<any>}
     */
    async enqueue(taskFn, taskId = 'unknown') {
        if (this.queue.length >= this.maxSize) {
            throw new Error(`[Queue] E_QUEUE_FULL: Dispatch queue is full (max ${this.maxSize})`);
        }

        return new Promise((resolve, reject) => {
            let timeoutId;
            const runTask = async () => {
                if (timeoutId) clearTimeout(timeoutId);
                this.running++;
                try {
                    const result = await taskFn();
                    resolve(result);
                } catch (err) {
                    reject(err);
                } finally {
                    this.running--;
                    this._pump();
                }
            };

            const rejectWithTimeout = (err) => {
                reject(err);
            };

            this.queue.push({ runTask, taskId, reject: rejectWithTimeout });

            // Set timeout for waiting in queue
            timeoutId = setTimeout(() => {
                const index = this.queue.findIndex(item => item.reject === rejectWithTimeout);
                if (index !== -1) {
                    this.queue.splice(index, 1);
                    rejectWithTimeout(new Error(`[Queue] E_QUEUE_TIMEOUT: Task ${taskId} timed out waiting in queue for ${this.timeoutMs}ms`));
                    this._pump(); // In case this was blocking something
                }
            }, this.timeoutMs);

            process.stderr.write(`[async-queue] Task ${taskId} queued. (queued: ${this.queue.length}, running: ${this.running}/${this.limit})\n`);
            this._pump();
        });
    }

    _pump() {
        if (this.running < this.limit && this.queue.length > 0) {
            const nextItem = this.queue.shift();
            nextItem.runTask();
        }
    }
}
