// Obsidian's own lint rules: the community-plugin scan runs the same set on every
// release, so an error here is a release that will not be listed. Plugin code only.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores(["node_modules", "main.js", "esbuild.config.mjs", "version-bump.mjs", "spikes", "tools", "tests", "docs", "templates"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.*"] },
      },
    },
  },
]);
