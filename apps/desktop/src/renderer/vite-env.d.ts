// Ambient module types for Vite imports (this file must not import anything, or these
// declarations would become augmentations instead).

declare module '*?worker&url' {
  const url: string;
  // eslint-disable-next-line import-x/no-default-export -- Vite's ?worker&url imports are default exports.
  export default url;
}

declare module '*.css';
