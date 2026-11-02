/**
 * Whether a chat message is one the whole table could read, which is the only kind the stream may show.
 *
 * The capture login is usually a GM, so "can this client see it" is the wrong question: a GM sees every
 * whisper. The stream's audience is everybody watching, and a whisper reaches only its recipients, a
 * single player included. A blind roll is hidden from its own roller. Neither is news for the stream.
 *
 * The roll-card readers (`stream-cards/pf2e/read-message.js`, `daggerheart/read-message.js`,
 * `text/read-text.js`) apply the same rule; this is the cloned-card path's copy of it, kept pure so the
 * tests can hold the two to each other.
 *
 * Pure: reads only `blind` and `whisper` off the message.
 */
export function isAudienceVisible(message) {
  if (!message) return false;
  if (message.blind) return false;
  const whisper = message.whisper;
  const recipients = Array.isArray(whisper) ? whisper.length : whisper instanceof Set ? whisper.size : 0;
  return recipients === 0;
}
