// Vite inlines `?raw` imports as strings, in both electron-vite builds and Vitest.
declare module '*.sql?raw' {
  const sql: string;
  // eslint-disable-next-line import-x/no-default-export -- Vite's ?raw imports are default exports.
  export default sql;
}
