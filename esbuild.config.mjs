import esbuild from "esbuild";
import process from "process";
import { readFileSync } from "fs";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

/**
 * The mobile guard, checked on the artifact rather than on the source.
 *
 * On iOS a `require("child_process")` throws at module load — before `onload`
 * runs, so the plugin does not degrade, it dies. Everything that touches Node
 * therefore lives under `src/desktop/` and is reached only through a dynamic
 * `import()`, which esbuild keeps inside a lazily-initialised closure.
 *
 * That property is easy to break by accident: one ordinary top-level import in
 * a file mobile loads pulls the whole subgraph back into the eager body, and
 * nothing about the source diff looks wrong. So the check is here, on the
 * bundle, where the truth actually lives — and it fails the build rather than
 * waiting for a phone to find out.
 */
function assertNoEagerNodeRequires(file) {
  const src = readFileSync(file, "utf8");
  // Everything before the CJS export marker is esbuild's prelude and its lazy
  // `__esm` closures; the eager module body is what runs at load.
  const body = src.slice(src.indexOf("module.exports="));
  const leaked = builtins.filter((name) => body.includes(`require("${name}")`));

  if (leaked.length) {
    console.error(
      `\nBuild failed: ${leaked.join(", ")} ${leaked.length === 1 ? "is" : "are"} required at load time.\n` +
        "Node builtins must stay behind `await import(\"./desktop/…\")` inside a\n" +
        "`Platform.isDesktopApp` branch, or the plugin will not load on iOS.\n",
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
  assertNoEagerNodeRequires("main.js");
  process.exit(0);
} else {
  await ctx.watch();
}
