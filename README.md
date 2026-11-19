# Secure App Starter

An interactive generator for a fresh React and Fastify application, with Google sign-in, administrator-approved registration, a protected workspace, and account audit trails.

Choose an app name, three brand colors, an author, and a description. The generator creates an independent local repository with its own configuration and keys.

**[Installation and usage guide → read.md](read.md)**

## Quick start

Requirements: Node.js **24.12 or newer within 24.x**, pnpm **10.25.x or compatible 10.x**, and Git.

Replace `YOUR_USERNAME` with the GitHub account hosting this repository:

```sh
git clone https://github.com/YOUR_USERNAME/secure-app-starter.git
cd secure-app-starter
corepack enable
corepack prepare pnpm@10.25.0 --activate
pnpm install --frozen-lockfile
pnpm create:app
```

If Corepack is unavailable, install pnpm 10.25.0 first, then run the final two commands. The repository's `packageManager` field pins the pnpm version.

The wizard asks for:

1. App title.
2. Primary color — default `#dbe6de`.
3. Secondary color — default `#244a3c`.
4. Tertiary color — default `#b8cbbd`.
5. Author name, optionally.
6. App description.

Press Enter to use a default. Enter colors as `#RGB` or `#RRGGBB`. Supporting shades and readable text colors are calculated during generation.

## Generated application

- React, TypeScript, Vite, Tailwind CSS v4, and shadcn/ui.
- TanStack Query for server state and Zustand for UI state.
- Fastify and MongoDB, with Google OAuth using state and PKCE.
- HttpOnly cookie sessions, inactivity expiry, and session revocation.
- Administrator-approved registrations and account-scoped audit records.
- Login, registration, 404, protected workspace, security, and approval screens.
- Unique local RSA/encryption keys, separate Git history, app-specific ports, and Docker configuration.

The login and 404 screens can run locally before Google and MongoDB are configured. Signing in requires the generated app's own Google OAuth credentials, database connection, and administrator configuration. See the generated app's README for the database setup and security boundaries.

## Use your own colors and metadata

From the cloned starter directory:

```sh
pnpm create:app "Route Planner" \
  --primary "#dbe6de" \
  --secondary "#244a3c" \
  --tertiary "#b8cbbd" \
  --author "Your Name" \
  --description "Plan your next route in one place." \
  --yes
```

The app is created beside the starter directory by default. `--directory` selects an existing parent directory. Existing projects are never overwritten. The generator creates a local Git repository; it does not create a GitHub repository or deploy the app.

Generated settings are stored in `app.config.json`. Theme colors live in `apps/web/src/theme.css`, with Tailwind/shadcn mappings in `index.css`. Author and description also populate package and HTML metadata. The description appears on the login screen.

## Repository structure

```text
secure-app-starter/
├── create-app.mjs       # Generator and project creation
├── settings.mjs         # Interactive prompts and CLI options
├── themes.mjs           # Hex-color validation and theme generation
├── template/
│   ├── apps/api/        # Fastify authentication, access, and audit API
│   ├── apps/web/        # React UI and shadcn components
│   ├── scripts/         # Required setup, build, Docker, and test helpers
│   └── ...              # App configuration, lockfile, and tooling
├── tests/               # Generator regression tests
├── README.md            # Project overview
└── read.md              # Complete installation and usage guide
```

**Keep `template/scripts/` committed.** Generated applications also need their `scripts/` directory committed. These contain source code; the private `.env` and `.secrets/` files they create are ignored by Git.

## Development checks

```sh
pnpm test
pnpm format:check
```

Inside a generated application, run `pnpm check` for lint, formatting, tests, and builds. Google/MongoDB integration requires your own configured services; regression tests use synthetic accounts and a transactional database double.

See **[read.md](read.md)** for setup, command options, troubleshooting, and what belongs in a public repository.
