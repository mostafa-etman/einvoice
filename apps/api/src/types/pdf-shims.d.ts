declare module 'arabic-persian-reshaper' {
  export const ArabicShaper: {
    convertArabic(text: string): string;
  };
  export const PersianShaper: {
    convertArabic(text: string): string;
  };
}

declare module 'bidi-js' {
  type EmbeddingLevels = unknown;
  type BidiApi = {
    getEmbeddingLevels(
      text: string,
      paragraphDirection?: 'ltr' | 'rtl' | 'auto',
    ): EmbeddingLevels;
    getReorderedString(text: string, levels: EmbeddingLevels): string;
  };
  export default function bidiFactory(): BidiApi;
}
