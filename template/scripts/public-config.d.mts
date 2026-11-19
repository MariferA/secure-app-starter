export function publicConfig(
  env: Record<string, string | undefined>,
  app: { name: string; slug: string },
): { name: string; slug: string; apiUrl: string };
