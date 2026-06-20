// module/socket.mjs — Socket communication for GM → Player notifications

import { onSocket, emitSocket } from "../../../core/socket.mjs";
import { enqueue } from "./queue.mjs";

const FEATURE_ID = "insight";

/**
 * Register the socket listener. Called once during `ready`.
 */
export function registerSocket() {
  onSocket(FEATURE_ID, handleMessage);
  console.log("Insight | Socket listener registered");
}

/**
 * Handle incoming socket messages.
 * @param {object} payload - The socket payload
 */
function handleMessage(payload) {
  if (payload.type !== "insight.notification") return;

  // Only process if this client's user is the target
  if (payload.target !== game.user.id) return;

  enqueue({
    id: payload.id,
    title: payload.title,
    body: payload.body,
    sense: payload.sense ?? null,
    image: payload.image ?? null,
    theme: payload.theme ?? null,
  });
}

/**
 * Send a notification to a target player via socket.
 * @param {object} data - Notification content
 * @param {string} data.target - Target user ID
 * @param {string} data.title - Notification title
 * @param {string} data.body - Notification body (HTML allowed)
 * @param {string} [data.sense] - Sense label
 * @param {string} [data.image] - Image URL
 * @param {string} [data.theme] - Theme override
 */
export function sendNotification(data) {
  const payload = {
    type: "insight.notification",
    id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    target: data.target,
    title: data.title,
    body: data.body,
    sense: data.sense || null,
    image: data.image || null,
    theme: data.theme || null,
  };

  emitSocket(FEATURE_ID, payload);

  // If GM is also the target (e.g., sending to self for testing),
  // handle locally since socket.emit doesn't echo back to sender
  if (payload.target === game.user.id) {
    handleMessage(payload);
  }
}
