/**
 * Sticker numbers — the names a pen's recordings go by.
 *
 * Pure, and deliberately in `shared/`: both the main process and the screens need to know what a
 * sticker number is, and a screen must never reach into `main/services/` for it. The first
 * attempt did exactly that, and pulled `node:fs` into the renderer bundle, which is the kind of
 * mistake the build catches only because the renderer has no Node.
 *
 * Every sticker printed so far is a four-digit number, and future sheets may use five. Those are
 * two different name spaces, not two spellings of one: **`0451` and `00451` may be different
 * stickers**, so nothing here pads, trims or otherwise converts between the two lengths.
 */

export const STICKER_DIGIT_LENGTHS = [4, 5] as const;

/** The only length in use on printed stickers today. Five-digit numbers are accepted and warned
 *  about, never refused: we do not hold the list of valid numbers, and a wrong guess at an upper
 *  bound would block a real sticker while looking, to the user, like a broken app. */
export const STICKER_DIGITS_IN_USE = 4;

export interface StickerNumber {
  /** The digits exactly as they appear, leading zeros included. */
  digits: string;
  /** 4 or 5. Never normalised — see the note above. */
  length: number;
}

/** Parses a DIY filename as a sticker number, or null if it is not one. */
export function parseStickerNumber(fileName: string): StickerNumber | null {
  const match = /^(\d{4,5})\.mp3$/i.exec(fileName);
  if (!match) return null;
  return { digits: match[1], length: match[1].length };
}

export const stickerFileName = (digits: string): string => `${digits}.mp3`;
