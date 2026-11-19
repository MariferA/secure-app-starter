# Installation and usage

This guide explains how to install **Secure App Starter**, generate a new application, and run that application locally. Commands below use a bash/zsh-style terminal.

## 1. Requirements

| Tool                | Version / purpose                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Node.js             | 24.12 or newer within the 24.x release line                                                          |
| pnpm                | 10.25.0 is pinned; use compatible 10.x tooling                                                       |
| Git                 | Required to initialize each generated repository                                                     |
| MongoDB             | Needed for authentication and persisted app data; use Atlas or a replica set supporting transactions |
| Google OAuth client | Needed to enable Google sign-in in a generated application                                           |
| Docker with Compose | Optional, for the generated application's container commands                                         |

Only Node.js, pnpm, and Git are needed to generate an application. Google and MongoDB credentials can be configured afterward.

Check your installed tools:

```sh
node --version
pnpm --version
git --version
```

## 2. Clone and install this repository

Replace `YOUR_USERNAME` with the account hosting the public repository, and adjust the repository name if it differs:

```sh
git clone https://github.com/YOUR_USERNAME/secure-app-starter.git
cd secure-app-starter
```

Enable the pinned package manager and install dependencies:

```sh
corepack enable
corepack prepare pnpm@10.25.0 --activate
pnpm install --frozen-lockfile
```

If your Node installation does not provide Corepack, install pnpm 10.25.0 separately, then run `pnpm install --frozen-lockfile`. You do not need to install this generator globally.

This installs the **generator's** dependencies. Each app you generate has its own dependency installation step.

## 3. Generate an application interactively

Run this from the cloned starter directory:

```sh
pnpm create:app
```

Example prompts:

```text
App title: Route Planner
Primary color [#dbe6de]:
Secondary color [#244a3c]:
Tertiary color [#b8cbbd]:
Author name (optional): Your Name
App description [A personal workspace built for your next idea.]: Plan your next route.
```

- Press Enter to accept a displayed default.
- Hex colors accept `#RGB` or `#RRGGBB` and are saved as lowercase six-digit values.
- Invalid color inputs are rejected and asked again.
- The app title becomes a safe lowercase directory name: `Route Planner` becomes `route-planner`.
- Ctrl+C cancels setup before creating a project.

If you already know the name:

```sh
pnpm create:app "Route Planner"
```

This skips the title question and asks for the remaining settings.

The default output is a sibling of the starter directory:

```text
projects/
├── secure-app-starter/
└── route-planner/
```

Each new app gets a fresh local Git repository on `main`, its own keys, a private `.env`, a database name, cookie names, and local ports. The generator prints its location and URLs. Dependency installation and the app's first commit are left to you. Existing destinations are never overwritten.

## 4. Generate an application without prompts

Quote hex values so your shell does not treat `#` as the start of a comment:

```sh
pnpm create:app "Route Planner" \
  --primary "#dbe6de" \
  --secondary "#244a3c" \
  --tertiary "#b8cbbd" \
  --author "Your Name" \
  --description "Plan your next route in one place." \
  --yes
```

| Option                  | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `--primary "#RRGGBB"`   | Primary brand color                                          |
| `--secondary "#RRGGBB"` | Secondary brand color                                        |
| `--tertiary "#RRGGBB"`  | Tertiary/accent brand color                                  |
| `--author "Name"`       | Author recorded in app, package, and HTML metadata           |
| `--description "Text"`  | App description, also shown on the login screen              |
| `--directory PATH`      | Existing parent folder for the generated app                 |
| `--yes` / `-y`          | Skip questions; use supplied settings and remaining defaults |
| `--help` / `-h`         | Show command usage                                           |

A title-only invocation in a noninteractive shell uses defaults. An invocation without a title needs an interactive terminal.

To choose a different destination, create the parent first:

```sh
mkdir -p ../generated-apps
pnpm create:app "Route Planner" --directory ../generated-apps
```

## 5. Install and run the generated application

For the default sibling location:

```sh
cd ../route-planner
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

`pnpm setup` preserves existing keys and settings. The generator already runs setup for a new app; this command is also needed after cloning a generated app onto a different machine. It creates `.env` from `.env.example` and generates keys in `.secrets/` when a complete key set is absent. It refuses a partial key set rather than silently replacing keys.

Open the frontend URL printed by the generator, using `localhost` consistently. Port selection starts at web `5180` and API `8084`, then skips occupied ports and ports recorded in sibling apps' `.env.example` files. The assigned values are saved in the app's `.env` and `.env.example`.

With blank service credentials, the local login/registration and 404 pages are available. Google sign-in stays disabled until both Google credentials and a MongoDB URI are configured. This does not create an authenticated test account.

## 6. Configure Google, MongoDB, and the administrator

Edit the **generated app's root `.env`**, not the starter repository:

| Setting                   | What to supply                                                        |
| ------------------------- | --------------------------------------------------------------------- |
| `MONGODB_URI`             | This application's MongoDB connection string                          |
| `MONGODB_APP_DATABASE`    | This application's database name; a value is generated from its title |
| `GOOGLE_CLIENT_ID`        | Google OAuth Web application client ID                                |
| `GOOGLE_CLIENT_SECRET`    | Matching Google client secret                                         |
| `GOOGLE_ALLOWED_EMAILS`   | Comma-separated verified Google emails allowed to administer the app  |
| `GOOGLE_ALLOWED_SUBJECTS` | Optional Google subject IDs for administrators                        |
| `FRONTEND_URL`            | The frontend origin; local value is generated for you                 |
| `API_BASE_URL`            | The API URL ending in `/api`; local value is generated for you        |

In Google Cloud, register the exact callback for the **assigned API port**:

```text
http://localhost:YOUR_API_PORT/api/auth/google/callback
```

For example, if `.env` says `API_PORT=8084`, the callback is:

```text
http://localhost:8084/api/auth/google/callback
```

Configure the OAuth consent screen and permitted test users when the Google project is in testing mode. If JavaScript origins are requested, use the generated frontend origin.

Prepare MongoDB collections and indexes with a temporary schema-capable credential:

```sh
pnpm --filter api db:prepare
```

Then use a restricted runtime credential and verify it:

```sh
pnpm --filter api security:check
```

The exact collection privileges are defined in `apps/api/src/maintenance/schema.ts`. The runtime user should have append-only access to audit records, not a broad database-owner role. The app requires MongoDB transactions, so a standalone MongoDB server is insufficient.

Restart `pnpm dev` after changing `.env`. Configured administrators can sign in directly. Other users request access on `/register`, wait for approval, and sign in afterward.

The generated README contains additional details about HTTPS production settings, trusted proxies, audit retention, encrypted audit context, and runtime database permissions.

## 7. Edit colors and app metadata

Generated `app.config.json` records your selections:

```json
{
  "name": "Route Planner",
  "slug": "route-planner",
  "author": "Your Name",
  "description": "Plan your next route in one place.",
  "theme": {
    "primary": "#dbe6de",
    "secondary": "#244a3c",
    "tertiary": "#b8cbbd"
  }
}
```

The generated `apps/web/src/theme.css` contains these exact colors plus supporting shades and contrasting foreground colors. `apps/web/src/index.css` maps them to Tailwind v4 and shadcn components, including tertiary/accent utilities.

These shades are calculated **during generation**. To change colors later, edit `theme.css`, including related foreground colors where necessary. Editing `app.config.json` alone does not regenerate the CSS, favicon, package metadata, or HTML metadata. Keep those files consistent when editing settings manually.

Reference: [Tailwind theme variables](https://tailwindcss.com/docs/theme).

## 8. Checks and optional Docker

In the starter repository:

```sh
pnpm test
pnpm format:check
```

In a generated app:

```sh
pnpm check
```

This runs lint, formatting, regression tests, and the frontend/API build checks. Regression tests use synthetic identities and a database double; live Google and MongoDB services require separate configuration.

Optional local Docker commands, from the generated app:

```sh
pnpm docker:up
pnpm docker:ps
pnpm docker:down
```

These use the app's own Compose project and loopback ports. MongoDB remains an externally configured service. Docker smoke checks do not configure a VPS, public domain, TLS proxy, or Google OAuth project.

## 9. Should the scripts folder be committed?

**Yes. Keep `template/scripts/` committed in this starter repository. Keep `scripts/` committed in every generated application.**

The generator itself imports `template/scripts/setup.mjs`, so removing that directory breaks project generation. Generated applications also reference these helpers from their package scripts, Vite configuration, and Dockerfile.

| File inside `template/scripts/` | Why it is included                                                    |
| ------------------------------- | --------------------------------------------------------------------- |
| `setup.mjs`                     | Creates the app's private local environment and key files             |
| `setup.test.mjs`                | Tests key isolation, preservation, and public configuration filtering |
| `public-config.mjs`             | Exposes the explicit public configuration used by the frontend build  |
| `public-config.d.mts`           | TypeScript declarations for the public configuration helper           |
| `render-nginx.mjs`              | Generates the web image's Nginx configuration from the public API URL |
| `docker.mjs`                    | Runs the generated app's scoped Compose commands                      |

Commit the source scripts, `.env.example`, package manifests, lockfiles, tests, and template files. Keep their generated private outputs out of Git:

```text
.env
.secrets/
node_modules/
dist/
coverage/
```

A generated application's `.gitignore` already excludes these private/runtime/build files. The starter's `.gitignore` excludes its own dependencies and private environment/key files. Do not remove required source folders to hide generated outputs.

## 10. Publishing and portfolio notes

Publish the **starter repository root**, containing `create-app.mjs`, `settings.mjs`, `themes.mjs`, `template/`, `tests/`, and both documentation files. The template is part of the generator's source distribution; its app configuration files contain substitution markers and are rendered when you generate an app. Run application commands in the generated app, not directly inside `template/`.

`README.md` is the GitHub-facing overview and links to this installation guide. Replace the example clone URL with your actual repository URL before publishing. `"private": true` in `package.json` prevents accidental package publication to npm; it does not choose GitHub repository visibility.

A concise portfolio description you can adapt:

> A configurable full-stack application generator built with React, TypeScript, Fastify, and MongoDB. It scaffolds Google authentication, administrator-approved access, account audit trails, shadcn UI, and custom primary/secondary/tertiary brand colors into independent local repositories.

The generator does not include a GitHub publishing step. Push the starter repository and any generated application as separate projects when you are ready.

## Troubleshooting

| Problem                                | What to check                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm` is not found                    | Enable Corepack or install pnpm 10.25.0, then reopen the terminal                               |
| Wrong Node version                     | Use Node 24.x, version 24.12 or newer                                                           |
| Destination already exists             | Choose another app title or a different parent directory; existing files are protected          |
| Wizard is not prompting                | Run in an interactive terminal, or supply a title and flags with `--yes`                        |
| Google sign-in needs setup             | Configure Google credentials and `MONGODB_URI` in the app's `.env`, then restart the API        |
| OAuth callback mismatch                | Match Google's redirect URI to the app's assigned API port and `/api/auth/google/callback` path |
| API fails after database configuration | Check connectivity, required indexes, runtime permissions, and replica-set/transaction support  |
| Partial key set found                  | Restore the app's original complete `.secrets/` key set; setup will not silently rotate it      |
| Missing helper scripts after cloning   | Ensure `template/scripts/` or the generated app's `scripts/` was committed                      |
