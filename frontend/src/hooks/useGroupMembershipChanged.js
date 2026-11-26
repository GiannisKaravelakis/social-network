// Owner: A (with C) — "a group membership changed somewhere else on the page"
//
// The problem: the bell is in the Navbar, on every page. If you are on
// /groups/2 looking at "You're invited: Accept / Decline" and you click
// Accept in the BELL instead, the group page doesn't know. It keeps showing
// the old buttons, and clicking them gives a 409 because the invite is gone.
//
// The fix: after the bell answers an invite or join request, it announces
// it with a browser event, and the group pages listen and reload. A plain
// window event is enough here: both sides run in the same tab, and nothing
// needs to be stored, so we don't need a new React context.
//
//   bell:        announceGroupMembershipChanged(group.id)
//   group pages: useGroupMembershipChanged((groupId) => { ...reload... })
import { useEffect, useRef } from "react";

const EVENT_NAME = "group-membership-changed";

export function announceGroupMembershipChanged(groupId) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { groupId } }));
}

export default function useGroupMembershipChanged(callback) {
  // Keep the newest callback in a ref, so the listener is added once and
  // still calls a callback that sees the latest state (same idea as B's
  // useSocketEvent).
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    function onChanged(e) {
      callbackRef.current(e.detail.groupId);
    }
    window.addEventListener(EVENT_NAME, onChanged);
    return () => window.removeEventListener(EVENT_NAME, onChanged);
  }, []);
}