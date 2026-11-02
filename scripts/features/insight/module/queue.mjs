// module/queue.mjs — one card at a time, and the card says how many are waiting.

import { renderNotification, setPending } from "./notification.mjs";

/** Gap between one card leaving and the next arriving, before the motion tier. */
export const QUEUE_GAP = 260;

/** @type {object[]} */
const queue = [];

/** @type {HTMLElement|null} the stage on screen, or null */
let current = null;
/** The id of the card being rendered or shown, or null. */
let activeId = null;
let active = false;

/**
 * Add a notification to the queue; shown at once when nothing is.
 * @param {object} data - card data (module/socket.mjs `cardData`)
 */
export function enqueue(data) {
  if (!data.id) data.id = `insight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // The same message twice (a GM's double click, a re-sent payload) is one card.
  if (queue.some((q) => q.id === data.id) || activeId === data.id) return;
  queue.push(data);
  if (!active) next();
  else if (current) setPending(current, queue.length);
}

function next() {
  current = null;
  activeId = null;
  if (!queue.length) {
    active = false;
    return;
  }
  active = true;
  const data = queue.shift();
  activeId = data.id;
  renderNotification({ ...data, pending: queue.length }, () => {
    current = null;
    setTimeout(next, QUEUE_GAP);
  })
    .then((el) => {
      // Released already (an instant tier, or disposed while it rendered).
      if (el?.isConnected) {
        current = el;
        setPending(el, queue.length);
      }
    })
    .catch((err) => {
      console.error("Insight | Notification render failed:", err);
      next();
    });
}

/** Cards on screen plus cards waiting (for debugging). */
export function getQueueLength() {
  return queue.length + (active ? 1 : 0);
}
