# API contract

One section per owner. For each endpoint: method, path, request JSON, response JSON, error codes.

## A: Accounts & social graph

Handler files: `pkg/handlers/auth.go`, `users.go`, `follows.go`, `notifications.go`. Models: `pkg/models/user.go`, `session.go`, `follow.go`, `notification.go`.
 
### Objects used in this part
 
**User**: the full profile. Returned by `/api/me`, login, register, and `GET /api/users/{id}` when you're allowed to see it.
 
```json
{
  "id": 7,
  "email": "maria@example.com",
  "first_name": "Maria",
  "last_name": "Papadopoulou",
  "date_of_birth": "2001-04-17",
  "nickname": "mpap",
  "about_me": "Hi!",
  "avatar": "/uploads/3f2a9c1e-....png",
  "is_private": false,
  "created_at": "2026-11-24T10:15:00Z",
  "followers_count": 12,
  "following_count": 30,
  "follow_status": "self",
  "can_view": true
}
```
 
`password_hash` is never in any response. The Go struct gets the tag `json:"-"` so it can't leak by accident.
 
**follow_status**: how the logged-in viewer relates to this user. Drives the Follow button.
 
| Value | Meaning | Button shows |
| --- | --- | --- |
| `"self"` | It's you | (no button, privacy toggle instead) |
| `"none"` | You don't follow them | Follow |
| `"pending"` | You sent a request, not answered yet | Requested (click = cancel) |
| `"following"` | Accepted follow | Unfollow |
 
---
 
### 1.1 Auth
 
#### `POST /api/register`: public
 
Creates an account. Does **not** log in. The frontend calls `POST /api/login` right after with the same email and password.
 
Request: `multipart/form-data` (because of the optional avatar).
 
| Field | Required | Rules |
| --- | --- | --- |
| `email` | yes | Trimmed, lowercased, valid per `net/mail.ParseAddress`, max 100 chars |
| `password` | yes | 8–72 characters (72 is bcrypt's limit) |
| `first_name` | yes | Trimmed, 1–50 chars |
| `last_name` | yes | Trimmed, 1–50 chars |
| `date_of_birth` | yes | `YYYY-MM-DD`, a real date, in the past |
| `nickname` | no | Trimmed, max 30 chars. Empty string = `null` |
| `about_me` | no | Max 500 chars. Empty string = `null` |
| `avatar` | no | Image file, see Part 0 Images |
 
Response `201`: the new **User** (`follow_status: "self"`, `can_view: true`, counts 0).
 
| Error | When |
| --- | --- |
| `400` | A required field is missing or a rule above fails. The message names the field, e.g. `"first_name is required"` |
| `409` | `"email already registered"` |
| `413` / `415` | Bad avatar |
 
curl:
 
```bash
curl -i -X POST localhost:8080/api/register \
  -F email=maria@example.com -F password=secret123 \
  -F first_name=Maria -F last_name=Papadopoulou -F date_of_birth=2001-04-17 \
  -F nickname=mpap -F avatar=@me.png
```
 
#### `POST /api/login`: public
 
```json
{ "email": "maria@example.com", "password": "secret123" }
```
 
Response `200`: the **User**, plus a `Set-Cookie: session_id=...` header.
 
| Error | When |
| --- | --- |
| `400` | Missing email or password |
| `401` | `"invalid email or password"`: the **same** message for an unknown email and a wrong password |
 
#### `POST /api/logout`
 
No body. Deletes the session row and sends an expired `session_id` cookie. Response `204`.
 
#### `GET /api/me`
 
Response `200`: your own **User**. `401` if not logged in. AuthContext calls this on every page load: `200` = logged in, `401` = show login.
 
---
 
### 1.2 Users and profiles
 
**The private-profile gate** (`models.CanViewProfile`), used by every endpoint marked *gated*:
 
> You may see a user's full profile, posts and follower lists if **it's you**, **or their profile is public**, **or you have an accepted follow** to them. Otherwise `403`.
 
#### `GET /api/users`
 
Everyone except you, for the "find people" page. Sorted by first name.
 
Response `200`:
 
```json
[
  { "id": 3, "first_name": "Nikos", "last_name": "K", "nickname": null, "avatar": null,
    "is_private": true, "follow_status": "pending" }
]
```
 
(UserSummary + `is_private` + `follow_status`.)
 
#### `GET /api/users/{id}`
 
Always `200` for an existing user, so the page can always show a name and a Follow button.
 
- If `can_view` is `true`: the full **User**.
- If `can_view` is `false` (private and you don't follow): **only** these fields. The rest is not sent at all, not just hidden in the UI:
```json
{
  "id": 3, "first_name": "Nikos", "last_name": "K", "nickname": null, "avatar": null,
  "is_private": true, "follow_status": "none", "can_view": false
}
```
 
| Error | When |
| --- | --- |
| `400` | `id` is not a number |
| `404` | No such user |
 
#### `PATCH /api/me/privacy`
 
```json
{ "is_private": true }
```
 
Response `200`: `{ "is_private": true }`.
 
Going **private → public** also accepts every pending request to you (and deletes their `follow_request` notifications). A public profile has no requests, so they would otherwise be stuck forever.
 
`400` if `is_private` is missing or not a boolean.
 
#### `GET /api/users/{id}/followers` and `GET /api/users/{id}/following`: *gated*
 
Accepted follows only. Response `200`: `[ UserSummary, ... ]`, newest first.
 
| Error | When |
| --- | --- |
| `403` | `"this account is private"` |
| `404` | No such user |
 
#### `GET /api/users/{id}/posts`: *gated*, **owned by B**, listed here because it uses the same gate. See Part 2.
 
---
 
### 1.3 Follows
 
Request IDs aren't needed: `follows` has the composite key `(follower_id, following_id)`, so "the request from user 3 to me" is already unique.
 
#### `POST /api/users/{id}/follow`
 
No body.
 
- Target is **public**: row inserted as `accepted`. Response `200` `{ "follow_status": "following" }`.
- Target is **private**: row inserted as `pending`, plus a `follow_request` notification to the target. Response `200` `{ "follow_status": "pending" }`.
| Error | When |
| --- | --- |
| `400` | Following yourself |
| `404` | No such user |
| `409` | Already following or already requested |
 
#### `DELETE /api/users/{id}/follow`
 
Unfollow, or cancel your own pending request (also deletes that request's notification). Response `204`.
 
`404` if you don't follow and haven't requested.
 
#### `GET /api/follow-requests`
 
Pending requests **to you**, newest first.
 
```json
[ { "user": { ...UserSummary }, "created_at": "2026-11-24T10:15:00Z" } ]
```
 
#### `POST /api/follow-requests/{userId}/accept` and `POST /api/follow-requests/{userId}/decline`
 
`{userId}` is the **requester's** ID. Accept sets the row to `accepted`; decline deletes it. Both delete the matching `follow_request` notification. Response `204`.
 
`404` if there's no pending request from that user to you. So nobody can accept a request addressed to someone else: the query always has `following_id = <logged-in user>`.
 
---
 
### 1.4 Notifications
 
#### Notification object
 
```json
{
  "id": 41,
  "type": "group_invite",
  "is_read": false,
  "created_at": "2026-11-24T10:15:00Z",
  "actor": { ...UserSummary },
  "group": { "id": 2, "title": "Go learners" },
  "event": null
}
```
 
| `type` | Sent to | `actor` | `group` | `event` | Bell shows | Accept / Decline call |
| --- | --- | --- | --- | --- | --- | --- |
| `follow_request` | the private user | requester | `null` | `null` | Accept / Decline | `POST /api/follow-requests/{actor.id}/accept` or `/decline` |
| `group_invite` | invitee | inviter | ✓ | `null` | Accept / Decline | `POST /api/groups/{group.id}/members/{my id}/accept` or `/decline` |
| `group_join_request` | group creator | requester | ✓ | `null` | Accept / Decline | `POST /api/groups/{group.id}/members/{actor.id}/accept` or `/decline` |
| `group_event` | every member except the event's creator | event creator | ✓ | ✓ | link to the group | none |
| `follow_accepted` (bonus) | the follower | the user who accepted | `null` | `null` | text | none |
| `new_follower` (bonus) | the public user | the new follower | `null` | `null` | text | none |
 
**Rule for everyone who creates request notifications (A, C):** when a request is accepted, declined or cancelled, delete its notification with `models.DeleteNotifications`. Then every `follow_request` / `group_invite` / `group_join_request` in the list is still open, and the bell can always show the buttons without asking "is this still pending?".
 
The bell decides what to call from `type`, so there is no "accept notification" endpoint: the domain endpoint does the work and cleans up the notification.

`group` is `{ "id", "title" }` and `event` is `{ "id", "title" }`, or `null`.

**How B and C create and clear notifications** (Go, in `pkg/handlers`): call the shared helpers on `Handler`. `notify` saves the row and pushes it live over the hub; both only log errors, so a failed notification never fails the real action.

```go
// C, invite (send to the invitee):
h.notify(models.NewNotification{UserID: inviteeID, ActorID: me, Type: models.NotifGroupInvite, GroupID: groupID})
// C, join request (send to the creator):
h.notify(models.NewNotification{UserID: creatorID, ActorID: me, Type: models.NotifGroupJoinRequest, GroupID: groupID})
// C, new event (loop over the members, skip the event's creator):
h.notify(models.NewNotification{UserID: memberID, ActorID: me, Type: models.NotifGroupEvent, GroupID: groupID, EventID: eventID})

// When the request is answered or cancelled (0 = "any"):
h.clearNotifications(inviteeID, models.NotifGroupInvite, 0, groupID)
h.clearNotifications(creatorID, models.NotifGroupJoinRequest, requesterID, groupID)
```
 
#### `GET /api/notifications`
 
Your 50 newest notifications, newest first. Response `200`: `[ Notification, ... ]`.
 
#### `GET /api/notifications/unread-count`
 
Response `200`: `{ "count": 3 }`. The badge on the bell. **Separate from the chat badge**, which is B's.
 
#### `POST /api/notifications/{id}/read`
 
Response `204`. `404` if it doesn't exist **or isn't yours** (the query is `WHERE id = ? AND user_id = ?`; we don't tell people which IDs exist).
 
#### `POST /api/notifications/read-all`
 
Response `204`. Called when the bell dropdown opens.
 
#### Live notifications (proposal for B's WebSocket, week 2)
 
`CreateNotification` also pushes over the hub with `hub.SendToUser(userID, msg)`:
 
```json
{ "type": "notification", "data": { ...Notification } }
```
 
The frontend prepends it to the list and adds 1 to the badge. B: confirm or change the envelope (`type` / `data`) in Part 2 so chat and notifications use the same shape.
 
---
 
### 1.5 Security notes for the audit (Part 1)
 
- **Passwords:** `bcrypt.GenerateFromPassword(pw, bcrypt.DefaultCost)` on register, `bcrypt.CompareHashAndPassword` on login. The plain password is never stored or logged.
- **Generic login error:** one message for "no such email" and "wrong password", so an attacker can't use login to find out which emails are registered. (Register still says `409`, because the audit requires it. That's an accepted trade-off.)
- **Session cookie:** `HttpOnly` means JavaScript, including an XSS payload, can't read it. `SameSite=Lax` means another site can't make the browser send it on a `POST`, which blocks CSRF on every state-changing route. Sessions expire after 7 days in the DB **and** in the cookie; the middleware checks `expires_at > now`, so a cookie someone copied stops working.
- **Logout deletes the row**, so the old cookie is useless even if someone kept it.
- **Private profile gate is on the backend.** A non-follower doesn't get the fields at all, so opening DevTools or calling the API with curl shows nothing more than the UI.
- **Every query uses `?` placeholders.** User input is never concatenated into SQL.
- **"Is this mine?" is in the WHERE clause** (`AND user_id = ?`, `AND following_id = ?`), not checked after loading the row. You can't act on someone else's notification or follow request by guessing an ID.
- **Images:** type from the bytes, size cap, UUID filename, so a user can't upload HTML/JS pretending to be a `.png`, and can't choose a filename that overwrites another file.
- **Known trade-off:** files under `/uploads` are served without a permission check. The UUID names make them unguessable, which is enough for this project. Say so if asked.
---


## B: Posts & real-time

### Shared objects
 
**UserSummary**: the small user object embedded in posts, comments and messages.
 
```json
{ "id": 3, "first_name": "Ada", "last_name": "Lovelace", "nickname": "ada", "avatar_path": "/uploads/3f2a....png" }
```
 
`nickname` and `avatar_path` are `null` when the user has not set them.
 
**Post**
 
```json
{
  "id": 12,
  "author": { "...UserSummary" },
  "group_id": null,
  "content": "Hello world",
  "image_path": "/uploads/9c1e....gif",
  "privacy": "public",
  "comment_count": 2,
  "created_at": "2026-11-25T14:30:00Z"
}
```
 
- `privacy` is `"public"`, `"almost_private"` or `"private"`.
- `group_id` is `null` for a normal post. For a group post it holds the group ID, and `privacy` is ignored (see C's section).
- `image_path` is `null` when there is no image.
**Comment**
 
```json
{
  "id": 7,
  "post_id": 12,
  "author": { "...UserSummary" },
  "content": "Nice!",
  "image_path": null,
  "created_at": "2026-11-25T15:02:00Z"
}
```
 
**Message**
 
```json
{
  "id": 40,
  "sender_id": 3,
  "receiver_id": 5,
  "content": "Hi 😀",
  "is_read": false,
  "created_at": "2026-11-27T09:15:00Z"
}
```
 
### Who can see a post
 
The server checks this on **every** read: feed, single post, a user's posts, and the comments of a post.
 
| Post | Visible to |
| --- | --- |
| Your own post | You, always |
| `public` | Every logged-in user |
| `almost_private` | The author's accepted followers |
| `private` | Only users listed in `allowed_viewers` |
| Group post (`group_id` set) | Members of that group only (checked first, `privacy` is ignored) |
 
A user's posts (`GET /api/users/{id}/posts`) are also gated by the profile rule: a private profile hides its posts from non-followers, whatever the post's own privacy.
 
### Posts
 
#### `POST /api/posts`: create a post
 
`multipart/form-data` (so an image can be attached):
 
| Field | Required | Notes |
| --- | --- | --- |
| `content` | yes | Text, 1 to 5000 characters, trimmed |
| `privacy` | no | `public` (default), `almost_private` or `private` |
| `allowed_viewers` | only if `privacy=private` | Comma-separated user IDs, e.g. `4,9,12`. At least one. Every ID must be an accepted follower of the author |
| `image` | no | JPEG, PNG or GIF, max 5 MB |
 
Response `201`: the created **Post**.
 
Errors: `400` empty content, bad privacy value, `private` with no viewers, or a viewer who does not follow you. `413` image too large. `415` wrong image type.
 
#### `GET /api/posts/feed`: my feed
 
Query: `limit` (default 20, max 50) and `before` (a post ID; return only older posts, for "load more").
 
The feed contains: your own posts, public posts, `almost_private` posts from users you follow, and `private` posts where you are an allowed viewer. Group posts are **not** in the feed. Newest first.
 
Response `200`:
 
```json
{ "posts": [ { "...Post" } ], "has_more": true }
```
 
#### `GET /api/posts/{id}`: one post
 
Response `200`: a **Post**. Errors: `404` if it does not exist **or** you are not allowed to see it.
 
#### `GET /api/users/{id}/posts`: posts on a profile
 
Same query parameters and response shape as the feed. Used by the profile page.
 
Returns only posts you are allowed to see. If the profile is private and you are not the owner or an accepted follower, the answer is `403`. Group posts are not included.
 
Errors: `403` private profile, `404` unknown user.
 
### Comments
 
#### `POST /api/posts/{id}/comments`: add a comment
 
`multipart/form-data`:
 
| Field | Required | Notes |
| --- | --- | --- |
| `content` | yes | Text, 1 to 2000 characters, trimmed |
| `image` | no | JPEG, PNG or GIF, max 5 MB |
 
Response `201`: the created **Comment**.
 
Errors: `400` empty content, `404` post missing or not visible to you, `413`, `415`.
 
#### `GET /api/posts/{id}/comments`: list comments
 
Oldest first. Response `200`:
 
```json
{ "comments": [ { "...Comment" } ] }
```
 
Errors: `404` post missing or not visible to you.
 
### Chat (private)
 
You may chat with a user if **at least one of you follows the other** (accepted follow). The server enforces this, not only the UI.
 
#### `GET /api/chat/contacts`: who can I chat with
 
Response `200`, most recent conversation first:
 
```json
{
  "contacts": [
    {
      "user": { "...UserSummary" },
      "last_message": { "...Message" },
      "unread_count": 2
    }
  ]
}
```
 
`last_message` is `null` if you have never written to each other.
 
#### `GET /api/chat/{userID}/messages`: conversation history
 
Query: `limit` (default 30, max 100) and `before` (a message ID, for scrolling up).
 
Response `200`, oldest first:
 
```json
{ "messages": [ { "...Message" } ], "has_more": false }
```
 
Errors: `403` you are not allowed to chat with this user, `404` unknown user.
 
#### `POST /api/chat/{userID}/read`: mark a conversation as read
 
No body. Marks every message from `{userID}` to you as read. Response `204`.
 
Errors: `403`, `404` as above.
 
#### `GET /api/chat/unread-count`: unread badge
 
Response `200`:
 
```json
{ "unread_count": 3 }
```
 
This counts private messages only. It is **separate from notifications** (A's bell).
 
### WebSocket: `GET /ws`
 
One connection per logged-in user, opened once by `WebSocketProvider` after login. The upgrade is authenticated with the session cookie. No valid cookie returns `401` and the connection is not upgraded.
 
**Every frame in both directions is JSON with this envelope**, shared by B (chat), A (notifications) and C (group chat):
 
```json
{ "type": "<event name>", "data": { } }
```
 
#### Client to server
 
| `type` | `data` | Effect |
| --- | --- | --- |
| `private_message` | `{ "to": 5, "content": "Hi 😀" }` | Saves the message and delivers it to user 5 |
| `group_message` | `{ "group_id": 3, "content": "Hi group 😀" }` | Saves the message and delivers it to confirmed group members |
 
`content` is 1 to 2000 characters. Emojis are plain UTF-8 text.
 
#### Server to client
 
| `type` | `data` | When |
| --- | --- | --- |
| `private_message` | a **Message** | You received a message. Also sent back to the sender's own connection(s), so a second tab stays in sync |
| `error` | `{ "message": "..." }` | A frame was refused (not allowed to chat, empty content, bad JSON). The connection **stays open** |
| `notification` | defined by A | New notification (sent by A through `hub.SendToUser`) |
| `group_message` | defined by C | New group chat message (sent by C through `hub.SendToGroup`) |
 
A refused message is logged on the server and never crashes it. Only the target user receives a private message, nobody else.
 
### Images
 
Uploaded images are saved by A's `utils.SaveImage` under a random UUID filename and served from `/uploads/`. `SaveImage` returns the URL path (for example `/uploads/9c1e....gif`). That exact value is stored in the database and returned as `image_path`, ready to use in an `<img src>`. Nothing adds or removes a prefix anywhere.


## C: Groups & events

All routes require authentication unless stated otherwise. User identity comes from the session cookie.

### Group creation and lists

- `POST /api/groups`
  - Request: `{"title":"...","description":"..."}`
  - Response: `201` with the created group object
  - Errors: `400` invalid fields, `401` user is not authenticated
- `GET /api/groups`
  - Response: `200` with a list of all groups and the current user's status (`member`, `invited`, `requested`, `none`)
- `GET /api/groups/{id}`
  - Response: `200` with the group, creator, members, and current user's status
  - Errors: `404` group does not exist

### Join requests and invitations

- `POST /api/groups/{id}/join`
  - Request: `{}` or no body
  - Response: `201` with `{}` after creating a `requested` status
  - Errors: `409` a request, invitation, or membership already exists
- `POST /api/groups/{id}/invite`
  - Request: `{"user_id":2}`
  - Response: `201` with `invited` status
  - Errors: `403` the caller is not a member, `409` the target is already a member or invited
  - Any group member can invite one of their followers
- `POST /api/groups/{id}/members/{user_id}/accept`
  - Request: `{}`
  - Response: `200` with `{}` after setting status to `member`
  - Invitations: the invited user accepts.
  - Join requests: only the group creator accepts.
- `POST /api/groups/{id}/members/{user_id}/decline`
  - Request: `{}`
  - Response: `204`
  - Invitations: the invited user declines.
  - Join requests: only the group creator declines.
- `GET /api/groups/{id}/members`
  - Response: `200` with confirmed members only
  - Errors: `403` the requester is not a member

### Events

- `POST /api/groups/{id}/events`
  - Request: `{"title":"...","description":"...","event_time":"2026-12-01T18:30"}`
  - Response: `201` with the created event
  - Only a member can create an event.
- `GET /api/groups/{id}/events`
  - Response: `200` with events, `going` and `not_going` counts, and the current user's response
  - Errors: `403` the requester is not a member
- `POST /api/groups/{id}/events/{event_id}/response`
  - Request: `{"response":"going"}` or `{"response":"not_going"}`
  - Response: `200` with updated counts
  - Only a member can respond. The user can change their existing response.

Common errors: `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict`, `500 Internal Server Error`.

### Group posts

- `POST /api/groups/{id}/posts`
  - `multipart/form-data`: `content` is required, optional `image`
  - Privacy is ignored for group posts
  - Response: `201` with the created Post
  - Errors: `403` the caller is not a confirmed member
- `GET /api/groups/{id}/posts?limit=&before=`
  - Response: `200` with `{ "posts": [], "has_more": false }`
  - Errors: `403` the caller is not a confirmed member

Existing `POST /api/posts/{id}/comments` and `GET /api/posts/{id}/comments` also work for group posts. `CanViewPost` requires confirmed membership before a comment can be read or created.

### Group chat

- `GET /api/groups/{id}/messages?limit=&before=`
  - Response: `200` with `{ "messages": [], "has_more": false }`, oldest first
  - Errors: `403` the caller is not a confirmed member, `404` the group does not exist

WebSocket client frame: `{"type":"group_message","data":{"group_id":3,"content":"Hi"}}`.