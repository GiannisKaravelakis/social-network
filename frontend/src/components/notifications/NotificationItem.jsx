// Owner: A — inline Accept / Decline
//
// One row in the bell's dropdown. What it shows and which buttons it has
// depend only on `type` (API.md 1.4). There is no "accept notification"
// endpoint: the buttons call the real domain endpoint, and THAT endpoint
// deletes the notification on the server. We then remove it from the list
// with onResolved.
//
//   type                 who sees it     Accept / Decline calls
//   follow_request       private user    POST /api/follow-requests/{actor.id}/accept|decline
//   group_invite         invitee (me)    POST /api/groups/{group.id}/members/{MY id}/accept|decline
//   group_join_request   group creator   POST /api/groups/{group.id}/members/{actor.id}/accept|decline
//
// Note the two group rows use the SAME endpoint with a different user ID:
// the URL always names the person who becomes (or doesn't become) a member.
// For an invite that's me; for a join request it's the requester (actor).
//
// Why sending these IDs is safe: the server re-checks everything from the
// session cookie, never from the notification:
//   - follow request: ... WHERE follower_id = <actor.id> AND following_id = <me>
//   - group invite: C's AcceptMember answers 403 unless <me> IS the invited user
//   - join request: C's AcceptMember answers 403 unless <me> is the group's creator
// So a hand-edited request can only answer requests addressed to YOU
// (audit: only the creator accepts join requests).
//
// XSS: names and titles are rendered as text children, so React escapes
// them. A group called "<img onerror=...>" shows up literally, never runs.
import { useState } from "react";
import { Link } from "react-router-dom";
import Avatar, { displayName } from "../common/Avatar.jsx";
import * as notificationsApi from "../../api/notifications.js";
import * as groupsApi from "../../api/groups.js";
import useAuth from "../../hooks/useAuth.js";
import { announceGroupMembershipChanged } from "../../hooks/useGroupMembershipChanged.js";

// "5m ago" style. Plain JS, no date library needed.
function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationItem({ notification, onResolved, onNavigate }) {
  const { id, type, is_read: isRead, created_at: createdAt, actor, group, event } = notification;
  const { user } = useAuth(); // me: the invitee, for group_invite
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Links close the dropdown (onNavigate) so the new page isn't covered.
  const actorLink = actor ? (
    <Link to={`/users/${actor.id}`} onClick={onNavigate} className="notification-strong">
      {displayName(actor)}
    </Link>
  ) : (
    <span className="notification-strong">Someone</span>
  );
  const groupLink = group ? (
    <Link to={`/groups/${group.id}`} onClick={onNavigate} className="notification-strong">
      {group.title}
    </Link>
  ) : null;

  let text;
  // `actions` holds two functions that take no arguments, so answer() below
  // doesn't need to know which endpoint or which IDs each type uses.
  let actions = null;

  switch (type) {
    case "follow_request":
      text = <>{actorLink} wants to follow you</>;
      if (actor) {
        actions = {
          accept: () => notificationsApi.acceptFollowRequest(actor.id),
          decline: () => notificationsApi.declineFollowRequest(actor.id),
        };
      }
      break;
    case "group_invite":
      text = <>{actorLink} invited you to join {groupLink}</>;
      // The member being accepted is ME, not the inviter.
      if (group && user) {
        actions = {
          accept: () => groupsApi.acceptGroupMember(group.id, user.id),
          decline: () => groupsApi.declineGroupMember(group.id, user.id),
          groupId: group.id,
        };
      }
      break;
    case "group_join_request":
      text = <>{actorLink} wants to join {groupLink}</>;
      // The member being accepted is the requester (actor).
      if (group && actor) {
        actions = {
          accept: () => groupsApi.acceptGroupMember(group.id, actor.id),
          decline: () => groupsApi.declineGroupMember(group.id, actor.id),
          groupId: group.id,
        };
      }
      break;
    case "group_event":
      text = (
        <>
          {actorLink} created the event <span className="notification-strong">{event?.title}</span> in {groupLink}
        </>
      );
      break;
    case "follow_accepted":
      text = <>{actorLink} accepted your follow request</>;
      break;
    case "new_follower":
      text = <>{actorLink} started following you</>;
      break;
    default:
      // An unknown type from a newer backend: show something, don't crash.
      text = <>New notification</>;
  }

  async function answer(call) {
    setBusy(true);
    setError("");
    try {
      await call();
      // A group page that is open right now (e.g. /groups/2 showing its own
      // Accept / Decline) reloads, so it doesn't show a stale invite.
      if (actions.groupId) announceGroupMembershipChanged(actions.groupId);
      onResolved(id); // server already deleted it; drop it locally
    } catch (err) {
      // Usually 404 / 409: the request was already answered or cancelled
      // somewhere else (another tab, the group page). Show why; the list is
      // refetched the next time the bell opens.
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <li className={`notification-item${isRead ? "" : " notification-unread"}`}>
      {actor && <Avatar user={actor} size={36} />}
      <div className="notification-body">
        <p className="notification-text">{text}</p>
        <time className="notification-time" dateTime={createdAt}>
          {timeAgo(createdAt)}
        </time>
        {actions && (
          <div className="notification-actions">
            <button type="button" className="btn-accept" disabled={busy} onClick={() => answer(actions.accept)}>
              Accept
            </button>
            <button type="button" className="btn-decline" disabled={busy} onClick={() => answer(actions.decline)}>
              Decline
            </button>
          </div>
        )}
        {error && <p className="form-error notification-error">{error}</p>}
      </div>
    </li>
  );
}