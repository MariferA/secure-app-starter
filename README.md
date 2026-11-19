# Secure app starter

Create an independent local app with an interactive setup wizard:

```sh
pnpm --dir ~/WebstormProjects/secure-app-starter create:app
```

The wizard asks for:

1. App title (also used to create the directory and repository name).
2. Primary color — for example, `#dbe6de` (the default).
3. Secondary color — default `#244a3c`.
4. Tertiary color — default `#b8cbbd`.
5. Author name (optional).
6. A short app description.

Press Enter to accept the displayed default. Ctrl+C cancels before creating an app. If you already know the title, `pnpm create:app "Another App"` skips the title question and asks for the remaining settings. Run either command in a terminal; generation refuses to overwrite an existing directory.

Your three colors apply to Tailwind/shadcn components, the login panel, navigation, buttons, dialogs, the 404 page, and the favicon. Generated apps keep the exact selected palette in `apps/web/src/theme.css`. This starter uses Tailwind v4's CSS theme configuration: [Tailwind theme variables](https://tailwindcss.com/docs/theme).

Text colors and supporting shades are derived automatically, so light and dark brand colors remain readable. Hex input accepts `#RGB` or `#RRGGBB` and is normalized to lowercase six-digit hex.

The app title, author, description, and three theme colors are saved in `app.config.json`. Author and description also populate package and HTML page metadata; the description appears on the login page. Author metadata is optional and no name is read from your Git account.

For scripting, pass settings directly and use `--yes` to skip prompts:

```sh
pnpm --dir ~/WebstormProjects/secure-app-starter create:app "Another App" \
  --primary "#dbe6de" \
  --secondary "#244a3c" \
  --tertiary "#b8cbbd" \
  --author "Your Name" \
  --description "A workspace for my next idea." \
  --yes
```

Optional flags: `--directory /absolute/parent/path`, `--primary "#RRGGBB"`, `--secondary "#RRGGBB"`, `--tertiary "#RRGGBB"`, `--author`, `--description`, `--yes` (`-y`), and `--help` (`-h`). A title-only command in a noninteractive shell keeps using defaults. Install the generator's dependencies once with `pnpm install` in this folder.

The generator creates a sibling directory, fresh Git repository on `main`, unique local keys, a blank private `.env`, and app-specific ports/cookies/database name. It never creates a GitHub repository, deploys, or reads another app's secrets. It does not create iOS builds.

Then follow the generated README, install the new app's dependencies with `pnpm install`, add its own Google/MongoDB credentials, prepare database indexes, and run `pnpm dev`.

The reusable template includes React/Vite/TypeScript, Tailwind/shadcn, TanStack Query/Zustand, Fastify/MongoDB, Google OAuth, cookie sessions, encrypted audit context, administrator-approved registration, session revocation, and an empty workspace.

Run `pnpm test` and `pnpm format:check` here to check the generator. Run `pnpm check` in a generated project to validate the app.
