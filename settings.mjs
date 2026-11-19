import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { getTheme, themes } from "./themes.mjs";
export const defaultDescription =
  "A personal workspace built for your next idea.";
export function metadataText(value, label, maxLength) {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    /[\x00-\x1f\x7f-\x9f]/.test(value)
  )
    throw new Error(
      label + " must be a single line of up to " + maxLength + " characters.",
    );
  return value.trim();
}
export function parseCliArgs(args) {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      directory: { type: "string" },
      theme: { type: "string" },
      author: { type: "string" },
      description: { type: "string" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (positionals.length > 1)
    throw new Error("Pass one app title, enclosed in quotes.");
  return { ...values, title: positionals[0] };
}
export async function collectSettings(
  options,
  { question, write, validateTitle },
) {
  const ask = async (label, validate, fallback) => {
    for (;;) {
      const answer = (
        await question(label + (fallback ? " [" + fallback + "]" : "") + ": ")
      ).trim();
      try {
        return validate(answer || fallback || "");
      } catch (error) {
        write(error.message + "\n");
      }
    }
  };
  const title =
    options.title ??
    (await ask("App title", (value) => {
      validateTitle(value);
      return value;
    }));
  validateTitle(title);
  let theme = options.theme;
  if (theme === undefined) {
    write(
      "\nChoose your color theme:\n" +
        themes
          .map((item, index) => "  " + (index + 1) + ". " + item.label)
          .join("\n") +
        "\n",
    );
    theme = await ask("Theme", (value) => getTheme(value).id, "forest");
  }
  const author =
    options.author ??
    (await ask("Author name (optional)", (value) =>
      metadataText(value, "Author", 100),
    ));
  const description =
    options.description ??
    (await ask(
      "App description",
      (value) => metadataText(value, "Description", 240),
      defaultDescription,
    ));
  return {
    ...options,
    title,
    theme: getTheme(theme).id,
    author: metadataText(author, "Author", 100),
    description:
      metadataText(description, "Description", 240) || defaultDescription,
  };
}
export async function promptSettings(options, validateTitle) {
  const controller = new AbortController();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.once("SIGINT", () => {
    controller.abort();
    rl.close();
  });
  rl.once("close", () => controller.abort());
  try {
    return await collectSettings(options, {
      question: (query) => rl.question(query, { signal: controller.signal }),
      write: (value) => process.stdout.write(value),
      validateTitle,
    });
  } finally {
    rl.close();
  }
}
