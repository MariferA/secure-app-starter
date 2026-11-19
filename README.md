# Secure app starter

Generate an independent local app from a title:

```sh
pnpm create:app "Another App"
```

Run this command in this folder, or use `pnpm --dir ~/WebstormProjects/secure-app-starter create:app "Another App"` from anywhere.

The generator creates a sibling directory, fresh Git repository on `main`, unique local keys, a blank private `.env`, and app-specific ports/cookies/database name. It refuses existing destinations. It never creates a GitHub repository, deploys, or reads another app's secrets. It does not create iOS builds.

Then follow the generated README and its setup section, install dependencies with `pnpm install`, add your own Google/MongoDB credentials, prepare database indexes, and run `pnpm dev`.

Optional: `node create-app.mjs "Another App" --directory /absolute/parent/path`. Titles become safe lowercase directory slugs. Dependency installation is intentionally explicit: generation itself uses Node and the installed Prettier formatter. Run `pnpm install` once in this starter folder.

The reusable template includes React/Vite/TypeScript, Tailwind/shadcn, TanStack Query/Zustand, Fastify/MongoDB, Google OAuth, cookie sessions, encrypted audit context, administrator-approved registration, session revocation, and an empty workspace. No business modules, bank messages, phone files, credentials, or previous Git history are copied.

Run `pnpm test` to check generation, collision protection, and isolation. Run `pnpm check` in a generated project to validate the app.
