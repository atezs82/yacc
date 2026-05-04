// Ambient declarations for CDN-loaded libraries (marked, highlight.js, DOMPurify)

interface MarkedOptions {
  gfm?: boolean;
  breaks?: boolean;
  highlight?: (code: string, lang: string) => string;
}

declare const marked: {
  use(options: MarkedOptions): void;
  parse(src: string): string;
};

declare const hljs: {
  getLanguage(name: string): unknown;
  highlight(code: string, options: { language: string }): { value: string };
  highlightElement(element: Element): void;
};

declare const DOMPurify: {
  sanitize(dirty: string): string;
};
