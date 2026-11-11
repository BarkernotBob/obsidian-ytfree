// Obsidian's own lint rules: the community-plugin scan runs the same set on every
// release, so an error here is a release that will not be listed. Plugin code only.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores(["node_modules", "main.js", "esbuild.config.mjs", "version-bump.mjs", "tools", "tests", "docs", "templates"]),
  ...obsidianmd.configs.recommended,
  // `src/desktop/` is the one place Node is allowed: it is reached only through
  // `await import()` inside a `Platform.isDesktopApp` branch, and the build fails
  // if a Node `require` leaks into the load path (esbuild.config.mjs). Obsidian's
  // own scan does not read this file and still lists these 19 imports as warnings.
  {
    files: ["src/desktop/**"],
    rules: { "obsidianmd/no-nodejs-modules": "off" },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.*"] },
      },
    },
  },
]);
