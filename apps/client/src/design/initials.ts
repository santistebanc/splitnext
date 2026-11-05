/**
 * Up to two initials of a name: the first letter of its first two words,
 * hyphenated parts counting as words, so “Léa-Marie Dubois” is “LM”. Letters
 * are whole characters, so an accent or an emoji is never split.
 */
export function initials(name: string): string {
  return name
    .split(/[\s-]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}
