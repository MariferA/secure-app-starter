export const defaultColors = Object.freeze({
  primary: "#dbe6de",
  secondary: "#244a3c",
  tertiary: "#b8cbbd",
});
export function normalizeHex(value, label = "Color") {
  if (
    typeof value !== "string" ||
    !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value.trim())
  )
    throw new Error(
      label + " must be a hex color such as #dbe6de (#RGB or #RRGGBB).",
    );
  const hex = value.trim().toLowerCase();
  return hex.length === 4
    ? "#" + [...hex.slice(1)].map((c) => c + c).join("")
    : hex;
}
const rgb = (color) =>
  color
    .slice(1)
    .match(/../g)
    .map((channel) => parseInt(channel, 16));
const mix = (from, to, amount) =>
  "#" +
  rgb(from)
    .map((channel, index) =>
      Math.round(channel + (rgb(to)[index] - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
function luminance(color) {
  const [r, g, b] = rgb(color).map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
export function contrastRatio(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function foregroundFor(background) {
  return ["#17201b", "#ffffff", "#000000"].find(
    (text) => contrastRatio(background, text) >= 4.5,
  );
}
function readableAccent(color, background) {
  const target = foregroundFor(background);
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, target, step / 20);
    if (contrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return target;
}
export function getTheme(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Use primary, secondary, and tertiary hex colors.");
  const palette = Object.fromEntries(
    Object.entries(defaultColors).map(([key, fallback]) => [
      key,
      normalizeHex(input[key] ?? fallback, key[0].toUpperCase() + key.slice(1)),
    ]),
  );
  const { primary, secondary, tertiary } = palette;
  const background = mix(primary, "#ffffff", 0.94),
    surface = mix(primary, "#ffffff", 0.98),
    foreground = foregroundFor(background);
  const muted = mix(tertiary, "#ffffff", 0.88),
    notice = mix(tertiary, "#ffffff", 0.8);
  return {
    palette,
    colors: {
      background,
      foreground,
      card: "#ffffff",
      primary,
      "primary-foreground": foregroundFor(primary),
      secondary,
      "secondary-foreground": foregroundFor(secondary),
      tertiary,
      "tertiary-foreground": foregroundFor(tertiary),
      muted,
      "muted-foreground": mix(foreground, background, 0.25),
      border: mix(primary, foreground, 0.18),
      ring: readableAccent(primary, background),
      story: secondary,
      "story-foreground": foregroundFor(secondary),
      "story-accent": readableAccent(tertiary, secondary),
      "story-muted": mix(foregroundFor(secondary), secondary, 0.15),
      surface,
      quiet: mix(foreground, background, 0.35),
      link: readableAccent(primary, surface),
      notice,
      "notice-foreground": foregroundFor(notice),
      "notice-border": mix(tertiary, foreground, 0.18),
      decoration: mix(tertiary, "#ffffff", 0.4),
    },
  };
}
export function themeCss(theme) {
  return (
    "/* Your three brand colors; supporting shades and readable text are derived. */\n:root {\n" +
    Object.entries(theme.colors)
      .map(([key, value]) => "  --theme-" + key + ": " + value + ";")
      .join("\n") +
    "\n  --theme-surface-alpha: #ffffffb0;\n  --theme-destructive: #a63b3b;\n}\n"
  );
}
