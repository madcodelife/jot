// How spoken words join the text around them. Pure, so tests call it alone.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}]/u;

/** Joins what was there and what was said: a space between two words of Latin letters, none between CJK. */
export function joinSpoken(before: string, spoken: string): string {
  if (!before || !spoken) return before + spoken;
  const last = [...before].pop() ?? "";
  const first = [...spoken][0] ?? "";
  const words = WORD.test(last) && !CJK.test(last) && WORD.test(first) && !CJK.test(first);
  return words ? `${before} ${spoken}` : before + spoken;
}

