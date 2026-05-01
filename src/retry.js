/**
 * retry.js — lightweight retry helpers for transient failures.
 */

/**
 * Call `fn()` once; if it throws, wait 1 second and call it again.
 * If the retry also throws, that error propagates to the caller.
 *
 * @param {() => Promise<any>} fn          — async function to call
 * @param {{ onRetry?: (err: Error) => void }} [opts]
 * @returns {Promise<any>}
 */
export async function retryOnce(fn, { onRetry } = {}) {
  try {
    return await fn();
  } catch (err) {
    if (onRetry) onRetry(err);
    // brief backoff before retry
    await new Promise((r) => setTimeout(r, 1000));
    return await fn();
  }
}
