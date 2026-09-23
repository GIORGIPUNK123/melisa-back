# melisa-back

Express API for Melisa. It uses the Supabase service role, so it can do things the browser is not allowed to do: create users, write wrapped keys, accept friendships, and create groups.

It does not decrypt messages. Chat text is encrypted in the browser before it is stored.

The deployed API is `https://melisa-back.onrender.com`.

## Run it

```bash
npm install
npm run dev
```

`npm run dev` uses nodemon and TypeScript. `npm run build` compiles to `dist`. `npm start` runs `node --use-system-ca dist/index.js`. Render uses that start command. `--use-system-ca` lets Node trust the machine certificate store.

The process listens on `PORT`, or `3000` if `PORT` is unset. This project's local `.env` uses `3006`. The frontend dev proxy expects that port.

### Environment

`.env` in this folder:

```
DB_URL=https://YOUR_PROJECT.supabase.co
DB_SECRET_KEY=your_service_role_key
PORT=3006
FRONTEND_URL=https://melisa-phi.vercel.app
```

`DB_URL` and `DB_SECRET_KEY` are required. The Supabase client is created in `index.ts`.

`FRONTEND_URL` is where email confirmation links send the user. If it is missing, the code uses `https://melisa-phi.vercel.app`. That value is at the top of `controllers/authController.ts`. Supabase still has to allow that URL under Authentication → URL Configuration, or the link falls back to the Supabase Site URL.

CORS is open (`cors()` with no origin lock). The website does not call this host from the browser. Vercel and Vite proxy `/api` to it.

`GET /health` returns `{ "status": "ok" }`. It does not check Supabase.

## What this server is for

The browser talks to Supabase directly for login, reading and sending messages, reactions, presence, and uploading encrypted files to `chat-media`.

This server is for work that needs the service role:

- registration and the first encryption keys
- friend requests, the friend list, and removing a friend
- blocks
- profile and password settings
- creating and managing groups
- deleting your own message and cleaning `chat-media` when a group is cleared or erased

`middlewares/authMiddleware.ts` reads `Authorization: Bearer <token>` and checks it with `supabase.auth.getUser`. The route then uses `req.user.id`.

## Auth

Routes are in `routes/authRouter.ts`.

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| POST | `/auth/register` | no | Create the auth user, keys, and profile |
| POST | `/auth/login` | no | Email and password session. The website does not use this. It signs in with the Supabase client. |
| POST | `/auth/otp` | no | Send a magic link |
| GET | `/auth/check-username?username=` | no | `{ exists: true/false }` |

Registration in `controllers/authController.ts`:

1. Reject the email if it is already in `users`.
2. Require the password rule in `functions/passwordPolicy.ts`: at least 6 characters and one number.
3. Create the Supabase auth user. The confirmation email redirects to `FRONTEND_URL`.
4. Generate an encryption key pair.
5. Derive a key from the password with Argon2id and encrypt the private key with AES-GCM.
6. Insert `users` with username, nickname, public key, encrypted private key, `iv`, and `salt`.

The browser does not send keys. This server creates them. After email confirmation, the user signs in and the website decrypts the stored private key with the same password.

Password changes do not happen on `/auth`. They go through `PUT /friends/settings` and must include the new password plus a new `encrypted_private_key`, `iv`, and `salt`. The key is saved before the auth password changes, so a failed password update does not leave the key wrapped with a password that was never set.

## Friends and blocks

Routes are in `routes/friendsRouter.ts`. Every route uses `authMiddleware`.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/friends/me` | Current user profile |
| GET | `/friends/list` | Accepted friends |
| POST | `/friends/add` | Send a friend request by username |
| GET | `/friends/pending` | Sent and received requests |
| POST | `/friends/request/:id/accept` | Accept. Creates the direct conversation if needed |
| DELETE | `/friends/request/:id` | Cancel a request you sent |
| DELETE | `/friends/request/:id/reject` | Reject a request you received |
| DELETE | `/friends/with/:friendUserId` | Remove an accepted friend |
| GET | `/friends/conversation/:friendUserId` | Get or create the direct chat |
| GET | `/friends/conversation/:conversationId/members` | Members of a conversation |
| GET | `/friends/profile/:username` | Public profile |
| PUT | `/friends/settings` | Nickname, avatar, email, appear offline, password plus re-wrapped key |
| POST | `/friends/block` | Block a user |
| DELETE | `/friends/block/:userId` | Unblock |

Friendships live in `friendships` with `pending` or `accepted`. The browser cannot delete accepted rows, so removal is done here.

A block is a row in `blocks`. This API refuses a friend request when either person has blocked the other. The browser also refuses to send a direct message in that case. Message rows themselves are written to Supabase by the browser. Deleting one of your own messages goes through this API so the file in storage is removed too. Deleting a group or clearing its history also removes the matching objects from `chat-media`. Leaving a chat only drops your membership; files stay for the other people.

## Groups

Routes are in `routes/conversationsRouter.ts`. The handler is `controllers/groupsController.ts`.

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/conversations/group` | Create a group |
| POST | `/conversations/group/:id/members` | Invite |
| DELETE | `/conversations/group/:id/members/:userId` | Remove a member |
| PUT | `/conversations/group/:id/admins/:userId` | Grant or remove admin |
| PUT | `/conversations/group/:id/name` | Rename |
| PUT | `/conversations/group/:id/photo` | Change the photo |
| POST | `/conversations/group/:id/leave` | Leave |
| DELETE | `/conversations/group/:id/messages` | Clear history |
| DELETE | `/conversations/group/:id` | Delete the group |
| GET | `/conversations/members/:conversationId` | Member profiles |
| DELETE | `/conversations/:conversationId/messages/:messageId` | Delete your own message, and its stored file if it has one |

Create group expects:

- `name`
- `memberIds`, including the creator, at least 2 people, at most 50
- `envelopes`: one `{ userId, nonce, keyBox }` per member

The envelopes are the group key sealed for each member. This server stores them in `conversation_key_envelopes`. It cannot open them.

The creator is an admin. Admin and per-member flags (`can_kick`, `can_change_name`, `can_change_photo`, `can_clear_messages`) live on `conversation_members`.

SQL for those columns is in `sql/`. Apply a file in the Supabase SQL editor when that feature is missing from the database. The files are:

- `sql/add_group_chats.sql`
- `sql/add_group_admin.sql`
- `sql/add_group_settings.sql`
- `sql/add_group_name_permission.sql`
- `sql/add_conversation_mute.sql`
- `sql/add_chat_media.sql`

`add_chat_media.sql` creates the private `chat-media` bucket. The website uploads encrypted photos, SVGs, zip files, and other attachments there. This API never receives the file and cannot decrypt it. The message row only stores a `file:v1` description. `kind` is `image` or `file`. The browser writes the message itself. Storage cleanup runs when you delete your own message, clear a group’s history, or erase a group.

## User lookup

`routes/userInfoRoute.ts` is mounted at both `/userinfo` and `/users`.

`GET /userinfo/:id` returns the public profile. If the caller asks for their own id, the response also includes email, encrypted private key, `iv`, and `salt`. The website uses that to unlock chats.

## Layout

```
index.ts                 Server, CORS, health, route mounts
routes                   URL paths only
controllers              Request handling
middlewares/authMiddleware.ts    Bearer token check
functions/passwordPolicy.ts      Password rule for signup and password change
functions/blocks.ts      Block checks
functions/chatMedia.ts   Remove objects from the chat-media bucket
functions/cryptoFunctions.ts     Key generation for registration
functions/getUserInfo.ts Profile lookup helper
sql                      Database changes to run by hand
```

Sending, reactions, and read state stay in the browser against Supabase. This API deletes your own message (and its file), clears or erases a group’s files in `chat-media`, and manages friends, blocks, settings, and groups.
