// Pure verification rules (no database), so they are easy to unit test (Jest-style tests, TC1/TC2).
//
// A swipe-in is AUTHORIZED when the lecturer has a slot in THIS room on THIS date and the swipe
// falls between (start - grace) and end. The grace period therefore allows early arrival; a late
// arrival is still verified until the slot ends.

/**
 * @param {{id:number,start_sec:number,end_sec:number}[]} slots  this user's slots in this room today
 * @param {number} nowSec  seconds since local midnight
 * @param {number} graceSec
 * @returns the matching slot or null
 */
export function findMatchingSlot(slots, nowSec, graceSec) {
  const matches = slots.filter((s) => nowSec >= s.start_sec - graceSec && nowSec <= s.end_sec);
  if (matches.length === 0) return null;
  // If back-to-back slots both match, prefer the one that is already in progress / starts latest.
  matches.sort((a, b) => b.start_sec - a.start_sec);
  return matches[0];
}

/** Status shown on the dashboard: never a false "Available" when the terminal is silent (FR13). */
export function computeRoomStatus({ lastHeartbeat, now, timeoutSec, session }) {
  const stale = !lastHeartbeat || now - new Date(lastHeartbeat) > timeoutSec * 1000;
  if (stale) return 'UNVERIFIED';
  if (!session) return 'AVAILABLE';
  return session.auth_status === 'AUTHORIZED' ? 'OCCUPIED_AUTHORIZED' : 'OCCUPIED_UNAUTHORIZED';
}
