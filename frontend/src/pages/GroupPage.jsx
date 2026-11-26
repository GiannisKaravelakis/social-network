import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import useAuth from "../hooks/useAuth.js";
import useGroupMembershipChanged from "../hooks/useGroupMembershipChanged.js";
import {
  acceptGroupMember,
  createEvent,
  declineGroupMember,
  getGroup,
  getGroupMembers,
  inviteToGroup,
  joinGroup,
  listEvents,
  respondToEvent,
} from "../api/groups.js";
import InvitePicker from "../components/groups/InvitePicker.jsx";
import EventForm from "../components/groups/EventForm.jsx";
import EventCard from "../components/groups/EventCard.jsx";

export default function GroupPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [tab, setTab] = useState("members");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadMemberData(groupId) {
    const [memberList, eventList] = await Promise.all([
      getGroupMembers(groupId),
      listEvents(groupId),
    ]);
    setMembers(memberList);
    setEvents(eventList);
  }

  useEffect(() => {
    let ignore = false;

    async function loadPage() {
      try {
        setLoading(true);
        setError("");
        const currentGroup = await getGroup(id);
        if (ignore) return;
        setGroup(currentGroup);

        if (currentGroup.status === "member") {
          await loadMemberData(id);
        }
      } catch (loadError) {
        if (!ignore) setError(loadError.message);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadPage();
    return () => { ignore = true; };
  }, [id]);

  // The bell (Navbar) answered an invite or join request for THIS group
  // while the page is open: reload so the buttons and member list are fresh.
  // `id` from the URL is a string, the bell sends a number.
  useGroupMembershipChanged(async (groupId) => {
    if (String(groupId) !== id) return;
    try {
      const currentGroup = await getGroup(id);
      setGroup(currentGroup);
      if (currentGroup.status === "member") {
        await loadMemberData(id);
      }
    } catch (reloadError) {
      setError(reloadError.message);
    }
  });

  async function refreshMembershipData() {
    const [currentGroup, memberList, eventList] = await Promise.all([
      getGroup(id),
      getGroupMembers(id),
      listEvents(id),
    ]);
    setGroup(currentGroup);
    setMembers(memberList);
    setEvents(eventList);
  }

  async function handleJoin() {
    try {
      setError("");
      await joinGroup(id);
      setGroup((current) => current ? { ...current, status: "requested" } : current);
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function handleMembershipAction(action, memberId) {
    try {
      setError("");
      await action(id, memberId);

      const currentGroup = await getGroup(id);
      setGroup(currentGroup);

      if (currentGroup.status === "member") {
        await loadMemberData(id);
      } else {
        setMembers([]);
        setEvents([]);
      }
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function handleAcceptInvite() {
    await handleMembershipAction(acceptGroupMember, user.id);
  }

  async function handleDeclineInvite() {
    await handleMembershipAction(declineGroupMember, user.id);
  }

  async function handleInvite(groupId, followerId) {
    try {
      setError("");
      await inviteToGroup(groupId, followerId);
      await refreshMembershipData();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function handleCreateEvent({ title, description, eventTime }) {
    try {
      setError("");
      await createEvent(id, title, description, eventTime);
      setEvents(await listEvents(id));
    } catch (actionError) {
      setError(actionError.message);
      throw actionError;
    }
  }

  async function handleRespond(eventId, response) {
    try {
      setError("");
      const updated = await respondToEvent(id, eventId, response);
      setEvents((current) =>
        current.map((event) => event.id === eventId ? updated : event)
      );
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  if (loading) return <section><p>Loading group...</p></section>;
  if (!group) return <section>{error ? <p role="alert">{error}</p> : <p>Group not found.</p>}</section>;

  const isMember = group.status === "member";
  const isCreator = user?.id === group.creator_id;

  return (
    <section className="group-page">
      <header>
        <h1>{group.title}</h1>
        <p>{group.description}</p>
        <p>{group.member_count} member(s)</p>

        {group.status === "none" && (
          <button type="button" onClick={handleJoin}>Request to join</button>
        )}
        {group.status === "requested" && (
          <button type="button" disabled>Join request sent</button>
        )}
        {group.status === "invited" && (
          <div className="invite-actions">
            <button type="button" onClick={handleAcceptInvite}>Accept invitation</button>
            <button type="button" onClick={handleDeclineInvite}>Decline invitation</button>
          </div>
        )}
      </header>

      {error && <p role="alert">{error}</p>}

      {!isMember ? (
        <p>Join or accept an invitation to see group content.</p>
      ) : (
        <>
          <nav className="group-tabs" aria-label="Group sections">
            <button type="button" onClick={() => setTab("members")} aria-pressed={tab === "members"}>Members</button>
            <button type="button" onClick={() => setTab("posts")} aria-pressed={tab === "posts"}>Posts</button>
            <button type="button" onClick={() => setTab("events")} aria-pressed={tab === "events"}>Events</button>
            <button type="button" onClick={() => setTab("chat")} aria-pressed={tab === "chat"}>Chat</button>
          </nav>

          {tab === "members" && (
            <section>
              <h2>Members</h2>
              {members.filter((member) => member.status === "member").map((member) => (
                <p key={member.user_id}>
                  {member.first_name} {member.last_name}
                  {member.nickname ? ` (${member.nickname})` : ""}
                </p>
              ))}

              {isCreator && members.filter((member) => member.status === "requested").length > 0 && (
                <section>
                  <h3>Join requests</h3>
                  {members.filter((member) => member.status === "requested").map((member) => (
                    <div className="member-action-row" key={member.user_id}>
                      <span>{member.first_name} {member.last_name}</span>
                      <button type="button" onClick={() => handleMembershipAction(acceptGroupMember, member.user_id)}>Accept</button>
                      <button type="button" onClick={() => handleMembershipAction(declineGroupMember, member.user_id)}>Decline</button>
                    </div>
                  ))}
                </section>
              )}

              <InvitePicker
                groupId={id}
                inviterId={user.id}
                members={members}
                onInvite={handleInvite}
              />
            </section>
          )}

          {tab === "posts" && (
            <section>
              <h2>Posts</h2>
              <p>Group posts will be connected in the next step with the B post components.</p>
            </section>
          )}

          {tab === "events" && (
            <section>
              <h2>Events</h2>
              <EventForm onCreate={handleCreateEvent} />
              {events.length === 0 && <p>No events yet.</p>}
              {events.map((event) => (
                <EventCard key={event.id} event={event} onRespond={handleRespond} />
              ))}
            </section>
          )}

          {tab === "chat" && (
            <section>
              <h2>Chat</h2>
              <p>Group chat will be connected after the B WebSocket chat component is ready.</p>
            </section>
          )}
        </>
      )}
    </section>
  );
}