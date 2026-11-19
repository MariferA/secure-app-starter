# __APP_TITLE_MARKDOWN__

A fresh React + TypeScript app with Vite, Tailwind, shadcn/ui, TanStack Query, Zustand, Fastify, and MongoDB. Includes Google sign-in, administrator-approved registration, an empty protected workspace, security/audit screens, and a 404 page.

```sh
pnpm install
pnpm setup
pnpm dev
```

Open `http://localhost:__WEB_PORT__`. The API runs on `http://localhost:__API_PORT__`.

Google sign-in stays disabled until this app has its own Google OAuth client and MongoDB connection. The setup instructions below cover database privileges, security, and optional local Docker. Never commit `.env` or `.secrets`. The generated keys are local and unique to this app.

```sh
pnpm check
pnpm --filter api db:prepare
pnpm --filter api security:check
```

No financial data, bank integrations, phone builds, deployment history, or credentials are included. No GitHub remote is created.

## Local setup

1. Use Node 24.12+ and pnpm 10.25. Run `pnpm install` and `pnpm setup`.
2. Edit the root `.env`. Supply a NEW Google OAuth Web application client and your own MongoDB URI. Set `GOOGLE_ALLOWED_EMAILS` to the administrator's verified Google email. Do not reuse another application's data or credentials.
3. In Google Cloud, configure OAuth consent and register this exact callback: `http://localhost:__API_PORT__/api/auth/google/callback`. Register `http://localhost:__WEB_PORT__` as the JavaScript origin if needed. For development/testing add permitted Google test users.
4. Set `MONGODB_APP_DATABASE=__DB_NAME__`. Use MongoDB Atlas or a local replica set: the app requires transactions. Standalone MongoDB is not supported.
5. Prepare the four collections/indexes using a temporary schema administrator: `pnpm --filter api db:prepare`. Remove that schema credential afterward. Assign the application a restricted database user with only the exact privileges exported by `apps/api/src/maintenance/schema.ts`. This includes find/insert/update on users and rate_limits; find/insert/update/remove on sessions; find/insert only on audit_events; and listIndexes. Do not grant readWrite/dbOwner or audit update/delete permissions. Run `pnpm --filter api security:check` with the runtime credential.
6. `pnpm dev`, then visit `http://localhost:__WEB_PORT__`. Administrators sign in directly. Other users request access on `/register`, wait for administrator approval, and sign in afterward.

## Security and boundaries

- Google OAuth uses state and PKCE S256. Google access tokens remain server-side. App JWTs use a new RSA 3072-bit key pair, issuer/audience isolation, and HttpOnly SameSite=Lax cookies. JavaScript never receives a session token.
- Every protected request checks the database session and current access status. 10-minute inactivity, 8-hour absolute expiry. Only human UI input records activity; polling/WebSocket updates do not extend sessions. Sensitive changes require authentication within five minutes and explicit shadcn AlertDialog confirmation.
- Mutation requests require the exact frontend Origin. WebSocket handshakes check both Origin and the HttpOnly session. Account access, audit reads, approvals, and session revocation are enforced server-side. Audit entries distinguish server evidence from browser-reported navigation.
- Audit metadata uses AES-256-GCM with authenticated record context. Mutations and audit writes share a MongoDB transaction, rolling back together if audit persistence fails. Runtime startup validates indexes; HTTPS production additionally validates least-privilege database permissions.
- Audit records expire after the configured retention (180 days by default). They are append-only for the restricted runtime user, not immutable against database administrators. User profiles (Google ID/email/display name) are normal database fields. No claim is made that all fields are encrypted.
- Each app has its own cookie name, issuer, keys, database name, Docker project, ports, and Git history. Back up `.secrets` privately: losing the data key makes existing encrypted audit metadata unreadable. Setup preserves keys and refuses partial sets. Rotation needs an explicit migration; rerunning setup does not rotate keys.
- Empty credentials allow the local login/setup and 404 screens; they never bypass authentication. No test sign-in is shipped. Tests use synthetic accounts and an in-memory database double; live Google OAuth and real MongoDB transactions still require your configured services.

## Checks

`pnpm check` runs lint, formatting, regression tests, and both production builds. `pnpm --filter api security:check` checks real runtime indexes and database privileges. Never supply real production credentials to regression tests.

## Optional local Docker

`pnpm docker:up`, `pnpm docker:ps`, `pnpm docker:down`. These use only this app's Compose project and bind published ports to loopback. The wrapper passes your local UID/GID so private key files remain readable by the non-root API. Docker uses an external MongoDB URI; no shared database, reverse proxy, TLS certificate, or VPS settings are included. Use an Atlas URI or an explicitly configured TLS-enabled replica set reachable from Docker. Production HTTPS needs an explicit TLS proxy, exact trusted proxy CIDR, and updated OAuth callback; this starter does not deploy itself.

## References

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://github.com/fastify/fastify-oauth2
- https://ui.shadcn.com/docs/components/radix/alert-dialog

## App settings

`app.config.json` stores the chosen name, author, description, and the primary/secondary/tertiary hex colors. The author and description also populate package metadata and the HTML page metadata. The description appears on the login page.

Edit `apps/web/src/theme.css` to customize the colors. Tailwind v4 uses CSS theme variables; `index.css` maps those tokens to Tailwind utilities and shadcn components. The login panel, navigation, buttons, dialogs, 404 page, and favicon use your palette. Your exact hex colors are kept as `--theme-primary`, `--theme-secondary`, and `--theme-tertiary`; supporting shades and contrasting text colors are derived automatically. Changing `app.config.json` alone does not regenerate the CSS.

Reference: https://tailwindcss.com/docs/theme
