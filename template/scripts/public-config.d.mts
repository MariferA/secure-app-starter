export function publicConfig(
  env: Record<string, string | undefined>,
  app: { name: string; slug: string; description?: string },
): { name: string; slug: string; apiUrl: string; description: string };
