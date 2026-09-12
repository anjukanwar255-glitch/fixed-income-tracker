/**
 * A mark for an issuer, worked out from its name.
 *
 * Every holding looked identical — the same bank glyph on every row — so a
 * list of ten was ten copies of one icon. A mark derived from the name gives
 * each issuer something of its own and, because it is derived rather than
 * fetched, it is there the moment a holding is added, for every issuer, with
 * nothing to look up and nothing to fail.
 */

/** Words that say what a company is registered as, not what it is called. */
const LEGAL_SUFFIXES = new Set([
  "limited", "ltd", "private", "pvt", "llp", "plc", "inc", "incorporated",
  "corporation", "corp", "company", "co", "and", "of", "the", "&",
]);

export function issuerInitials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !LEGAL_SUFFIXES.has(word.toLowerCase()));

  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A fixed set rather than a computed hue: a hash into the whole colour wheel
 * lands on muddy and unreadable as often as not. These are picked to sit
 * together in a list and to carry white text.
 */
const MARK_COLOURS = [
  "#0f766e", "#1d4ed8", "#7c3aed", "#b45309", "#be123c",
  "#0369a1", "#4d7c0f", "#a21caf", "#c2410c", "#115e59",
];

export function issuerColour(name: string) {
  // Stable across sessions and devices: the same issuer is the same colour
  // wherever it is shown, which is the only reason the mark is recognisable.
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return MARK_COLOURS[hash % MARK_COLOURS.length];
}

export function issuerMark(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return { initials: "?", colour: MARK_COLOURS[0] };
  return { initials: issuerInitials(trimmed), colour: issuerColour(trimmed) };
}
