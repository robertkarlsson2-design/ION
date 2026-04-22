import { get_encoding } from '@dqbd/tiktoken';
import type { Tiktoken, TiktokenEncoding } from '@dqbd/tiktoken';

export type TokenizerName = 'cl100k' | 'o200k';

const encodingMap: Record<TokenizerName, TiktokenEncoding> = {
  cl100k: 'cl100k_base',
  o200k: 'o200k_base',
};

const encoderCache = new Map<TokenizerName, Tiktoken>();

/** Returns the number of tokens for the given text using the specified tokenizer. */
export function countTokens(text: string, tokenizer: TokenizerName): number {
  let enc = encoderCache.get(tokenizer);
  if (enc === undefined) {
    enc = get_encoding(encodingMap[tokenizer]);
    encoderCache.set(tokenizer, enc);
  }
  return enc.encode(text).length;
}
