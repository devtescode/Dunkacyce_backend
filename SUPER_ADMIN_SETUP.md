# Super Admin Setup

One account can hold `role: "superadmin"`. It is the only account allowed to create, update, block, unblock, or delete regular admins (`role: "admin"`).

## 1. Environment variables

Copy `.env.example` to `.env` and fill in real values. Relevant entries:

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no | Server port (default `5000`) |
| `URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | Signs user tokens |
| `ADMIN_JWT_SECRET` | yes | Signs admin tokens |
| `API_SECRET` | yes | Existing API secret |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes | Existing image uploads |
| `SUPER_ADMIN_ACTIVATION_KEY` | yes, for activation | One-time key that authorizes promoting the first admin to super admin. **Backend only — never expose it to the frontend or a browser bundle.** |
| `ADMIN_BOOTSTRAP_KEY` | optional | If set, `POST /admin/register` requires a matching `bootstrapKey` in the body for the first admin. |

On startup the app connects to MongoDB and calls `Admin.ensureAdminSchemaReady()`, which creates the unique partial index on `role: "superadmin"` (so only one super admin can ever exist) and backfills defaults on legacy admin documents.

## 2. Bootstrap the first admin

`POST /admin/register` is public **only while zero admins exist**. It always creates `role: "admin"`, never `superadmin`.

```bash
curl -X POST http://localhost:5000/admin/register \
  -H "Content-Type: application/json" \
  -d '{"username":"owner","email":"owner@example.com","password":"a-strong-password"}'
```

If `ADMIN_BOOTSTRAP_KEY` is set, also send `"bootstrapKey": "<that key>"`. Check `GET /admin/exists` first; it reports whether registration is still open.

## 3. Log in

```bash
curl -X POST http://localhost:5000/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"a-strong-password"}'
```

The response contains `token`, `admin` (with `role` and `status`), `role`, and `isSuperAdmin`. Store the token as admin auth (e.g. `adminToken`) and send it as `Authorization: Bearer <token>` on the endpoints below.

## 4. Activate the single super admin

```bash
curl -X POST http://localhost:5000/api/superadmin/activate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <adminToken>" \
  -d '{"activationKey":"<SUPER_ADMIN_ACTIVATION_KEY>"}'
```

- `400` — missing `activationKey`; `403` — wrong key; `503` — env key not configured; `409` — a super admin already exists.
- **The activating session stays valid.** Activation deliberately does not increment `tokenVersion` — session revocation is reserved for block/deactivate/unblock/delete. The response returns the upgraded `admin` (now `role: "superadmin"`), the frontend mirrors that role into its stored identity, and `GET /api/superadmin/me` confirms `canManageAdmins: true`. Because middleware reads the role from MongoDB on every request, no token refresh is required (log out/in only if you want the JWT `role` claim updated).

## 5. Route table

All paths are absolute. Admin endpoints require `Authorization: Bearer <adminToken>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/superadmin/activate` | active admin | Promote caller to the single super admin |
| GET | `/api/superadmin/status` | public | `{ exists, hasSuperAdmin, activated }` |
| GET | `/api/superadmin/me` | verifyAdmin | Current admin identity and `canManageAdmins` |
| GET | `/api/superadmin/admins` | super admin | List/search admins with `search,status,page,limit` plus stats/pagination |
| POST | `/api/superadmin/admins` | super admin | Create a regular admin (body `{username,email,password}`) |
| PATCH | `/api/superadmin/admins/:id/status` | super admin | `{status:"active"|"inactive"}` or `{isActive:boolean}` |
| PATCH | `/api/superadmin/admins/:id/block` | super admin | Block admin and revoke sessions (optional `{reason}`) |
| PATCH | `/api/superadmin/admins/:id/unblock` | super admin | Restore to active; never grants super admin |
| DELETE | `/api/superadmin/admins/:id` | super admin | Remove an admin |

Aliases with identical authorization exist under `/admin/admins`: `GET ""`, `POST ""`, `PATCH /:id`, `DELETE /:id`, `PATCH /:id/block`, `PATCH /:id/unblock`.

Errors use `{ message: string, code?: string }`. Passwords and hashes are never returned.

## 6. Security notes

- Keep `SUPER_ADMIN_ACTIVATION_KEY` and `ADMIN_BOOTSTRAP_KEY` server-side only. Do not use a `VITE_` prefix, commit them, or return them from any API.
- Use a long random value (e.g. `openssl rand -hex 32`) and rotate it after activation.
- Role checks always read the DB record, never a role claim from a token/body. Every admin write verifies status and `tokenVersion`, so blocking or deactivating an admin revokes existing sessions immediately.
- The super admin cannot block, deactivate, or delete itself; only one super admin can exist due to the unique partial index.
- Serve the API over HTTPS in production and restrict CORS origins to the deployed frontend.
