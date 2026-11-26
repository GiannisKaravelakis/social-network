// Owner: A — Follow / Requested / Unfollow
//
// A "controlled" button: the PARENT owns follow_status (it came from the
// server in GET /api/users or GET /api/users/{id}) and passes it in. After a
// click we tell the parent the new status with onChange(newStatus), and the
// parent decides what else to refresh (the profile page reloads the whole
// profile, the users list just updates one row).
//
// The button never guesses the new status itself after a follow: the server
// answers "following" for a public profile and "pending" for a private one,
// and we use that answer. Only the server knows whether the profile is
// private right now (the owner may have just flipped the toggle).
//
//   status    | label      | click does
//   "none"      Follow       POST   /api/users/{id}/follow
//   "pending"   Requested    DELETE /api/users/{id}/follow  (cancel request)
//   "following" Unfollow     DELETE /api/users/{id}/follow
//   "self"      (nothing: you can't follow yourself)
//
// Bonus (audit: "confirmation pop-up when unfollowing"): "Unfollow" first
// opens a <ConfirmDialog>, and only "Yes" sends the DELETE. Cancelling a
// pending request does NOT ask: it's harmless and you can just click Follow
// again. Unfollowing a PRIVATE profile is not harmless: you lose access to
// their posts and must send a new request, so the message says so.
//
// The pop-up is only a UI nicety. It is not a security check: the server
// still decides everything from the session cookie.
import { useState } from "react";
import * as usersApi from "../../api/users.js";
import ConfirmDialog from "../common/ConfirmDialog.jsx";

const LABELS = {
  none: "Follow",
  pending: "Requested",
  following: "Unfollow",
};

// What a screen reader / hover tooltip says the click will do. "Requested"
// alone doesn't tell you that clicking it cancels the request.
const HINTS = {
  none: "Follow",
  pending: "Cancel follow request",
  following: "Unfollow",
};

// `name` and `isPrivate` are optional and only used for the pop-up's text.
// Both parents (ProfilePage, UsersPage) already have them from the server.
export default function FollowButton({ userId, status, onChange, name, isPrivate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (status === "self" || !LABELS[status]) return null;

  // Runs one API call with the busy flag and error handling around it.
  async function run(call) {
    setBusy(true);
    setError("");
    try {
      await call();
    } catch (err) {
      // Usually a stale button: e.g. in another browser tab you already
      // followed them (409) or they declined your request (404). Show the
      // server's message; the parent's next reload fixes the label.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleClick() {
    if (status === "none") {
      run(async () => {
        const res = await usersApi.follow(userId);
        onChange?.(res.follow_status); // "following" or "pending"
      });
    } else if (status === "pending") {
      run(async () => {
        await usersApi.unfollow(userId); // cancel the request, no pop-up
        onChange?.("none");
      });
    } else {
      setConfirming(true); // "following": ask first, see handleConfirmUnfollow
    }
  }

  async function handleConfirmUnfollow() {
    await run(async () => {
      await usersApi.unfollow(userId);
      onChange?.("none");
    });
    // Close even on an error: the message shows next to the button.
    setConfirming(false);
  }

  const who = name || "this user";
  const unfollowMessage = isPrivate
    ? `${who}'s profile is private. You will no longer see their posts or info, and you'll have to send a new follow request to see them again.`
    : `You will stop seeing ${who}'s followers-only posts. You can follow them again at any time.`;

  return (
    <span className="follow-button-wrap">
      <button
        type="button"
        className={`follow-button follow-button-${status}`}
        onClick={handleClick}
        disabled={busy} // no double POST from a double click
        title={HINTS[status]}
        aria-label={HINTS[status]}
      >
        {busy ? "…" : LABELS[status]}
      </button>
      {error && <span className="form-error follow-button-error">{error}</span>}
      <ConfirmDialog
        open={confirming}
        title={`Unfollow ${who}?`}
        message={unfollowMessage}
        confirmLabel="Unfollow"
        danger
        busy={busy}
        onConfirm={handleConfirmUnfollow}
        onCancel={() => setConfirming(false)}
      />
    </span>
  );
}