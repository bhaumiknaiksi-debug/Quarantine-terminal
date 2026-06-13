/**
 * @file /core/scheduler.js
 * @description Master timing, priority execution, and rendering scheduler for EDGE V6.
 * Implements a strict triple-scheduler architecture (Task, Frame, Background) to decouple 
 * business logic execution from DOM mutations, enforce frame budgets, and ensure background persistence.
 * @version 6.0.0
 * @module scheduler
 */

/**
 * Task Execution Priorities.
 * Determines survival in the execution queue during high-load frames.
 * @readonly
 * @enum {number}
 */
export const PRIORITY = Object.freeze({
    CRITICAL: 0, // Must execute (e.g., WS heartbeats, Risk threshold alerts)
    HIGH: 1,     // Should execute (e.g., Market tick processing, Alpha scoring)
    NORMAL: 2,   // Executes if frame budget allows (e.g., secondary analytics)
    LOW: 3,      // Often skipped/deferred if tight (e.g., non-vital pre-calculations)
    IDLE: 4      // Background only via requestIdleCallback (e.g., Journal cleanup)
});

/**
 * Fallback for Safari/Older browsers lacking requestIdleCallback
 */
const requestIdle = typeof window.requestIdleCallback === 'function' 
    ? window.requestIdleCallback 
    : (cb) => setTimeout(() => cb({ timeRemaining: () => Math.max(0, 50 - (performance.now() % 50)) }), 1);

const cancelIdle = typeof window.cancelIdleCallback === 'function' 
    ? window.cancelIdleCallback 
    : clearTimeout;

/* ==========================================================================
   TASK SCHEDULER (Business Logic & Engine Pacing)
   ========================================================================== */

class TaskScheduler {
    constructor() {
        this._queues = {
            [PRIORITY.CRITICAL]: new Map(),
            [PRIORITY.HIGH]: new Map(),
            [PRIORITY.NORMAL]: new Map(),
            [PRIORITY.LOW]: new Map()
        };
        
        // Adaptive pacing: Multiplier applied to task intervals when the system is under stress
        this._throttleMultiplier = 1.0;
    }

    /**
     * Registers a recurring logic task.
     * @param {string} id - Unique task identifier.
     * @param {Function} callback - Execution logic.
     * @param {number} interval - Target interval in ms.
     * @param {number} priority - TASK_PRIORITY enum.
     */
    schedule(id, callback, interval = 0, priority = PRIORITY.NORMAL) {
        if (priority === PRIORITY.IDLE) {
            throw new Error('[TaskScheduler] IDLE tasks must be scheduled via BackgroundScheduler.');
        }

        this._queues[priority].set(id, {
            id,
            callback,
            baseInterval: interval,
            nextRun: performance.now() + interval
        });
    }

    /**
     * Removes a logic task by ID.
     */
    remove(id) {
        for (const queue of Object.values(this._queues)) {
            if (queue.delete(id)) return true;
        }
        return false;
    }

    /**
     * Processes logic queues. Called by FrameScheduler (active) or BackgroundScheduler (hidden).
     * @param {number} startTime - High-res timestamp of the cycle start.
     * @param {number} availableBudget - Milliseconds allocated for this cycle.
     */
    process(startTime, availableBudget) {
        // 1. Execute Critical & High tasks unconditionally if their time is up
        this._runQueue(this._queues[PRIORITY.CRITICAL], startTime, Infinity);
        this._runQueue(this._queues[PRIORITY.HIGH], startTime, Infinity);

        // 2. Check remaining budget
        let usedTime = performance.now() - startTime;
        let timeRemaining = availableBudget - usedTime;

        // 3. Execute Normal tasks conditionally
        if (timeRemaining > 0) {
            this._runQueue(this._queues[PRIORITY.NORMAL], startTime, timeRemaining);
            usedTime = performance.now() - startTime;
            timeRemaining = availableBudget - usedTime;
        }

        // 4. Execute Low tasks conditionally
        if (timeRemaining > 0) {
            this._runQueue(this._queues[PRIORITY.LOW], startTime, timeRemaining);
        }

        this._evaluatePerformance(startTime);
    }

    /**
     * Executes tasks within a specific priority queue, respecting budget limits.
     * @private
     */
    _runQueue(queue, currentTime, budget) {
        const queueStartTime = performance.now();

        for (const [id, task] of queue.entries()) {
            // Stop processing this queue if we've exceeded the allocated budget for it
            if ((performance.now() - queueStartTime) > budget) break;

            if (currentTime >= task.nextRun) {
                try {
                    task.callback(currentTime);
                } catch (error) {
                    console.error(`[TaskScheduler] Task execution failed: ${id}`, error);
                } finally {
                    // Apply adaptive pacing to interval calculation
                    const actualInterval = task.baseInterval * this._throttleMultiplier;
                    task.nextRun = currentTime + actualInterval;
                }
            }
        }
    }

    /**
     * Measures cycle execution time and adjusts the adaptive pacing throttle.
     * @private
     */
    _evaluatePerformance(startTime) {
        const totalUsed = performance.now() - startTime;

        // If tasks take longer than 10ms, the UI might drop frames.
        if (totalUsed > 10.0) {
            console.warn(`[TaskScheduler] Frame budget exceeded! Used: ${totalUsed.toFixed(2)}ms. Throttling non-critical jobs.`);
            // Gradually increase throttle (max 3x slowdown) to recover frame rate
            this._throttleMultiplier = Math.min(this._throttleMultiplier + 0.1, 3.0);
        } else {
            // Gradually recover to baseline pacing
            this._throttleMultiplier = Math.max(this._throttleMultiplier - 0.05, 1.0);
        }
    }
}

/* ==========================================================================
   FRAME SCHEDULER (DOM Mutation & requestAnimationFrame)
   ========================================================================== */

class FrameScheduler {
    constructor(taskSchedulerRef) {
        this._taskScheduler = taskSchedulerRef;
        this._rAFId = null;
        this._isRunning = false;
        
        // Render Batching
        this._renderQueue = new Set();
        
        // Dynamic display sync metrics
        this._lastFrameTime = performance.now();
        this._targetBudget = 10.0; // Assume 10ms safe limit for logic, adapts dynamically
        
        this._tick = this._tick.bind(this);
    }

    /**
     * Starts the synchronization loop to the display refresh rate.
     */
    start() {
        if (this._isRunning) return;
        this._isRunning = true;
        this._lastFrameTime = performance.now();
        this._rAFId = requestAnimationFrame(this._tick);
    }

    /**
     * Halts the render loop.
     */
    pause() {
        this._isRunning = false;
        if (this._rAFId) {
            cancelAnimationFrame(this._rAFId);
            this._rAFId = null;
        }
    }

    /**
     * Enqueues a DOM mutation function to be executed safely at the end of the frame.
     * Guarantees that the UI renderer never mutates DOM during business logic execution.
     * @param {Function} renderFn - Function containing DOM updates.
     */
    requestRender(renderFn) {
        this._renderQueue.add(renderFn);
    }

    /**
     * Core display synchronization loop.
     * @private
     */
    _tick(timestamp) {
        if (!this._isRunning) return;

        const delta = timestamp - this._lastFrameTime;
        this._lastFrameTime = timestamp;

        // Dynamic budget calculation based on monitor refresh rate (delta)
        // Leave ~4ms buffer for browser layout/paint operations.
        this._targetBudget = Math.max(4.0, delta - 4.0); 

        const frameStartTime = performance.now();

        // 1. Execute Engine Tasks (Logic Phase)
        this._taskScheduler.process(frameStartTime, this._targetBudget);

        // 2. Execute DOM Mutations (Render Phase)
        if (this._renderQueue.size > 0) {
            this._flushRenderQueue();
        }

        // 3. Sync next frame
        this._rAFId = requestAnimationFrame(this._tick);
    }

    /**
     * Drains the render queue synchronously in a single batch.
     * @private
     */
    _flushRenderQueue() {
        for (const renderTask of this._renderQueue) {
            try {
                renderTask();
            } catch (error) {
                console.error('[FrameScheduler] Render queue execution failed:', error);
            }
        }
        // Clear queue after batch processed
        this._renderQueue.clear();
    }
}

/* ==========================================================================
   BACKGROUND SCHEDULER (Persistence & Idle Time)
   ========================================================================== */

class BackgroundScheduler {
    constructor(taskSchedulerRef, frameSchedulerRef) {
        this._taskScheduler = taskSchedulerRef;
        this._frameScheduler = frameSchedulerRef;
        
        this._idleTasks = new Map();
        this._idleCallbackId = null;
        this._hiddenIntervalId = null;
        
        this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._handleVisibilityChange);

        // Kickstart idle loop
        this._scheduleNextIdle();
    }

    /**
     * Registers a low-priority maintenance task (Cleanup, Storage writes).
     * @param {string} id - Unique task identifier.
     * @param {Function} callback - Execution logic.
     */
    scheduleIdle(id, callback) {
        this._idleTasks.set(id, callback);
    }

    /**
     * Removes an idle task.
     */
    removeIdle(id) {
        this._idleTasks.delete(id);
    }

    /**
     * Reacts to the user switching tabs or minimizing the browser.
     * @private
     */
    _handleVisibilityChange() {
        if (document.hidden) {
            console.info('[BackgroundScheduler] Tab hidden. Pausing FrameScheduler, initiating heartbeat interval.');
            this._frameScheduler.pause();
            cancelIdle(this._idleCallbackId);
            
            // Browsers heavily throttle intervals in background tabs (~1000ms max).
            // We bypass the paused FrameScheduler to manually drive critical logic.
            this._hiddenIntervalId = setInterval(() => {
                this._taskScheduler.process(performance.now(), 50.0); // Generous budget for background
            }, 1000);
            
        } else {
            console.info('[BackgroundScheduler] Tab active. Resuming FrameScheduler.');
            clearInterval(this._hiddenIntervalId);
            this._hiddenIntervalId = null;
            this._frameScheduler.start();
            this._scheduleNextIdle();
        }
    }

    /**
     * Enqueues the next browser idle callback cycle.
     * @private
     */
    _scheduleNextIdle() {
        if (document.hidden) return;

        this._idleCallbackId = requestIdle((deadline) => {
            for (const [id, callback] of this._idleTasks.entries()) {
                // Yield back to browser if time is exhausted
                if (deadline.timeRemaining() < 2) break;
                
                try {
                    callback(deadline);
                } catch (error) {
                    console.error(`[BackgroundScheduler] Idle task failed: ${id}`, error);
                }
            }
            this._scheduleNextIdle();
        }, { timeout: 2000 }); // Force execution at least every 2 seconds
    }
}

/* ==========================================================================
   MODULE ORCHESTRATION & EXPORT
   ========================================================================== */

export const taskScheduler = new TaskScheduler();
export const frameScheduler = new FrameScheduler(taskScheduler);
export const backgroundScheduler = new BackgroundScheduler(taskScheduler, frameScheduler);
