// Owner: A — bonus: unfollow + privacy pop-ups
//
// A yes/no pop-up built on the browser's own <dialog> element, so we get the
// hard parts for free (no library needed):
//   - showModal() puts it in the browser's "top layer": above the navbar and
//     everything else, with a dimmed ::backdrop, no z-index fights.
//   - the page behind it can't be clicked or tabbed into while it's open.
//   - Escape closes it (the browser fires a "cancel" event, we treat it as No).
//
// It is CONTROLLED, like FollowButton: the parent owns `open` and decides what
// "confirm" does. The dialog itself never calls the API, so the same component
// works for unfollowing, the privacy toggle, or anything else later.
//
//   <ConfirmDialog
//     open={asking}
//     title="Unfollow Maria?"
//     message="..."
//     confirmLabel="Unfollow"
//     danger
//     onConfirm={doUnfollow}
//     onCancel={() => setAsking(false)}
//   />
//
// XSS: title and message are rendered as text children, so React escapes
// them. A nickname like "<img onerror=...>" is shown literally.
import { useEffect, useId, useRef } from "react";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);
  // A unique id per dialog: the users page has one FollowButton (and so one
  // dialog) per row, and HTML ids must not repeat.
  const titleId = useId();

  // React only renders the element; opening and closing a <dialog> as a
  // modal has to go through its methods, so we sync them with `open` here.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape: the browser would close the dialog by itself, behind React's
  // back. preventDefault keeps `open` as the single source of truth, and the
  // parent closes it through onCancel like any other "No".
  function handleCancel(e) {
    e.preventDefault();
    if (!busy) onCancel();
  }

  // A click on the dimmed backdrop counts as "No". The backdrop belongs to
  // the <dialog> element itself, so the click target is the dialog, not one
  // of the elements inside the box.
  function handleClick(e) {
    if (e.target === ref.current && !busy) onCancel();
  }

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={handleCancel}
      onClick={handleClick}
      aria-labelledby={titleId}
    >
      <div className="confirm-dialog-box">
        <h2 id={titleId} className="confirm-dialog-title">
          {title}
        </h2>
        {message && <p className="confirm-dialog-message">{message}</p>}
        <div className="confirm-dialog-actions">
          {/* autoFocus on Cancel: pressing Enter by reflex does the safe thing. */}
          <button type="button" className="btn-decline" onClick={onCancel} disabled={busy} autoFocus>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-accept"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}