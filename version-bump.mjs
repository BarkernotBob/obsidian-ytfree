// `npm version x.y.z` runs this: it copies the new version into manifest.json
// and records which Obsidian version it needs in versions.json. The tag npm
// then makes is bare `x.y.z` (see .npmrc), which is what Obsidian requires.
import { readFileSync, writeFileSync } from "fs";

const version = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
