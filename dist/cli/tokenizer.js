import { get_encoding } from '@dqbd/tiktoken';
const encodingMap = {
    cl100k: 'cl100k_base',
    o200k: 'o200k_base',
};
const encoderCache = new Map();
/** Returns the number of tokens for the given text using the specified tokenizer. */
export function countTokens(text, tokenizer) {
    let enc = encoderCache.get(tokenizer);
    if (enc === undefined) {
        enc = get_encoding(encodingMap[tokenizer]);
        encoderCache.set(tokenizer, enc);
    }
    return enc.encode(text).length;
}
