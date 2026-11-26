// Owner: A — find people to follow
//
// GET /api/users returns everyone except you, sorted by name, each as a
// UserSummary + is_private + follow_status (API.md 1.2). Only summary fields
// are sent, so listing private users here leaks nothing: their email,
// birthday and posts stay behind the profile gate.
import { useEffect, useState } from "react";
import * as usersApi from "../api/users.js";
import UserCard from "../components/users/UserCard.jsx";
import { displayName } from "../components/common/Avatar.jsx";
import FollowButton from "../components/users/FollowButton.jsx";

export default function UsersPage() {
  const [users, setUsers] = useState(null); // null = still loading
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let ignore = false; // don't set state if we left the page before the answer
    usersApi
      .listUsers()
      .then((list) => !ignore && setUsers(list))
      .catch((err) => !ignore && setError(err.message));
    return () => {
      ignore = true;
    };
  }, []);

  // A follow click only changes that one row's status, so we update it in
  // place instead of reloading the whole list.
  function setStatus(id, followStatus) {
    setUsers((list) => list.map((u) => (u.id === id ? { ...u, follow_status: followStatus } : u)));
  }

  if (error) return <p className="page-loading">{error}</p>;
  if (!users) return <p className="page-loading">Loading…</p>;

  // Filtering in the browser is fine: we already have the whole list, and it
  // only holds public summary fields. It matches first/last name and nickname.
  const q = query.trim().toLowerCase();
  const shown = q
    ? users.filter((u) =>
        [u.first_name, u.last_name, u.nickname, `${u.first_name} ${u.last_name}`]
          .some((s) => s?.toLowerCase().includes(q)),
      )
    : users;

  return (
    <section className="users-page">
      <h1>People</h1>
      <input
        type="search"
        className="users-search"
        placeholder="Search by name or nickname"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search people"
      />

      {users.length === 0 && <p className="profile-muted">No one else has registered yet.</p>}
      {users.length > 0 && shown.length === 0 && <p className="profile-muted">No one matches “{query}”.</p>}

      <div className="user-list">
        {shown.map((u) => (
          <UserCard key={u.id} user={u}>
            {u.is_private && (
              <span className="user-card-private" title="Private profile">
                🔒
              </span>
            )}
            <FollowButton
              userId={u.id}
              status={u.follow_status}
              onChange={(s) => setStatus(u.id, s)}
              name={displayName(u)}
              isPrivate={u.is_private}
            />
          </UserCard>
        ))}
      </div>
    </section>
  );
}