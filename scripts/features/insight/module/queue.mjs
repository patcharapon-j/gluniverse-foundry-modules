// module/queue.mjs — Notification queue (one at a time)

import { renderNotification } from "./notification.mjs";

/** @type {object[]} */
const queue = [];

/** @type {boolean} */
let active = false;

/**
 * Add a notification to the queue.
 * If nothing is currently showing, render immediately.
 * @param {object} data - Notification payload
 */
export function enqueue(data) {
  // Assign a unique ID if not present
  if (!data.id) data.id = `insight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  queue.push(data);
  if (!active) next();
}

/**
 * Render the next notification in the queue.
 * Called after dismiss or when the queue gets its first entry.
 */
function next() {
  if (queue.length === 0) {
    active = false;
    return;
  }

  active = true;
  const data = queue.shift();

  renderNotification(data, () => {
    // Small delay between dismiss and next notification
    setTimeout(next, 300);
  }).catch(err => {
    console.error("Insight | Notification render failed:", err);
    active = false;
    next();
  });
}

/**
 * Get the current queue length (for debugging).
 * @returns {number}
 */
export function getQueueLength() {
  return queue.length + (active ? 1 : 0);
}
