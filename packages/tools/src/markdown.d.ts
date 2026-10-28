/** Bundled text files (the built-in skills), imported with `with { type: "text" }`. */
declare module "*.md" {
  const text: string;
  export default text;
}
