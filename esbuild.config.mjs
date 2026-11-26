import esbuild from "esbuild";
import process from "process";
import { readFileSync } from "fs";
import { builtinModules } from "node:module";

// Both spellings, e.g. `fs` and `node:fs`, as the builtin-modules package listed them.
const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const prod = process.argv[2] === "production";

/**
 * The store guard, checked on the artifact rather than on the source.
 *
 * Since 0.2.2 the plugin uses no Node at all: no `fs`, no `child_process`, no
 * `https`. The community directory's scan rates any of them a warning (Shell
 * Execution, Direct Filesystem Access, Node built-in imports), and on iOS an
 * eager `require` of one kills the plugin at load. One stray import in any
 * file brings that back without the diff looking wrong, so the build fails on
 * a Node `require` anywhere in the bundle.
 */
function assertNoNodeRequires(file) {
  const src = readFileSync(file, "utf8");
  const guarded = [...builtins, "@electron/remote"];
  const leaked = guarded.filter((name) => src.includes(`require("${name}")`));

  if (leaked.length) {
    console.error(
      `\nBuild failed: main.js requires ${leaked.join(", ")}.\n` +
        "YouTube for You uses no Node modules (0.2.2): the store scan flags them and iOS cannot load them.\n",
    );
    process.exit(1);
  }
}

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // CodeMirror must stay external. Obsidian's editor is a running CM6 instance;
  // bundling a second copy means our keymap registers against a different
  // module and silently never fires.
  external: [
    "obsidian",
    "electron",
    // Desktop-renderer only; nothing uses it since 0.2.2, and the guard above
    // fails the build if anything starts to.
    "@electron/remote",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/language",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await ctx.rebuild();
  assertNoNodeRequires("main.js");
  process.exit(0);
} else {
  await ctx.watch();
}
