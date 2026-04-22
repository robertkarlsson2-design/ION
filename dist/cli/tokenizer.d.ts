export type TokenizerName = 'cl100k' | 'o200k';
/** Returns the number of tokens for the given text using the specified tokenizer. */
export declare function countTokens(text: string, tokenizer: TokenizerName): number;
