import english from "./en.json" with { type: "json" };
import type { Locale } from "../../lib/ipc/types";

export type Parameters = Record<string, string | number>;
export function translate(
  source: string,
  locale: Locale,
  parameters: Parameters = {},
): string {
  const message =
    locale === "en" && Object.prototype.hasOwnProperty.call(english, source)
      ? (english as Record<string, string>)[source]
      : source;
  // One pass keeps names and paths containing braces literal.
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name)
      ? String(parameters[name])
      : placeholder,
  );
}
