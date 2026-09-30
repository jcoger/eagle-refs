#!/usr/bin/env node
/**
 * background: tag as you save, with no terminal after setup. Installs a macOS launch agent
 * that runs `eagle-refs enrich` whenever Eagle changes the library.
 *
 *   eagle-refs background on       # install and start (runs once now, then on every save)
 *   eagle-refs background status   # on or off, and the last lines of its log
 *   eagle-refs background off      # stop and remove it
 *
 * How it runs: Eagle rewrites the library's mtime.json on every save. launchd (the part of
 * macOS that starts background jobs) watches that file and starts enrich at most once a
 * minute, so a burst of saves is one run. Enrich tags what is new and quits; nothing stays
 * running between saves. An hourly run catches anything a save event missed.
 *
 * The job runs from a tiny app bundle, "eagle-refs.app", only so macOS names it. A launch
 * agent that runs node or zsh directly shows in System Settings > Login Items, and in the
 * "Background Items Added" alert, as "Node.js Foundation" (node's signer) or "zsh". Wrapped in
 * an app with a local (ad-hoc) signature and linked by AssociatedBundleIdentifiers, it shows
 * as "eagle-refs".
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, libraryName } from "../lib/config.mjs";

const cfg = config();
const slug = libraryName().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "library";
const LABEL = `com.eagle-refs.${slug}`;
const PLIST = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const LOG = join(homedir(), "Library/Logs", `eagle-refs-${slug}.log`);
const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "eagle-refs.mjs");
const DOMAIN = `gui/${process.getuid()}`;
const APP = join(homedir(), "Library/Application Support/eagle-refs", slug, "eagle-refs.app");
const EXE = join(APP, "Contents/MacOS/eagle-refs");

const launchctl = (...args) => spawnSync("launchctl", args, { encoding: "utf8" });
const loaded = () => launchctl("print", `${DOMAIN}/${LABEL}`).status === 0;
// launchctl bootout returns before the job is gone; wait for it (up to 5 s) so on/off never race.
function unload() {
  if (!loaded()) return;
  launchctl("bootout", `${DOMAIN}/${LABEL}`);
  for (let i = 0; i < 50 && loaded(); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
}
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The named wrapper: Info.plist + a two-line script that runs enrich, signed ad-hoc. */
function writeApp() {
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  rmSync(APP, { recursive: true, force: true });
  mkdirSync(dirname(EXE), { recursive: true });
  writeFileSync(join(APP, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${x(LABEL)}</string>
  <key>CFBundleName</key><string>eagle-refs</string>
  <key>CFBundleDisplayName</key><string>eagle-refs</string>
  <key>CFBundleExecutable</key><string>eagle-refs</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSBackgroundOnly</key><true/>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>Tags what you save to Eagle (${x(libraryName())}) so your AI tools can search it.</string>
</dict>
</plist>
`);
  writeFileSync(EXE, `#!/bin/zsh
# eagle-refs background job for ${libraryName()}. Written by \`eagle-refs background on\`.
exec ${q(process.execPath)} ${q(BIN)} enrich --config ${q(cfg.file)}
`);
  chmodSync(EXE, 0o755);
  const sign = spawnSync("codesign", ["--force", "--sign", "-", APP], { encoding: "utf8" });
  if (sign.status !== 0) console.error(`background: could not sign the app (${sign.stderr.trim()}); macOS may show it as "zsh"`);
}

function plist() {
  const args = [EXE];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by \`eagle-refs background on\`. Remove with \`eagle-refs background off\`. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${x(LABEL)}</string>
  <key>AssociatedBundleIdentifiers</key>
  <array><string>${x(LABEL)}</string></array>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${x(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${x(dirname(cfg.file))}</string>
  <key>EnvironmentVariables</key>
  <dict><key>EAGLE_REFS_LOG</key><string>${x(LOG)}</string></dict>
  <key>WatchPaths</key>
  <array><string>${x(join(cfg.library, "mtime.json"))}</string></array>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>${x(LOG)}</string>
  <key>StandardErrorPath</key><string>${x(LOG)}</string>
</dict>
</plist>
`;
}

const sub = process.argv[2] ?? "status";
if (sub === "on") {
  const watch = join(cfg.library, "mtime.json");
  if (!existsSync(watch)) { console.error(`background: ${watch} not found. Is "library" right in ${cfg.file}?`); process.exit(1); }
  mkdirSync(dirname(PLIST), { recursive: true });
  mkdirSync(dirname(LOG), { recursive: true });
  unload(); // before rewriting the app it runs from
  writeApp();
  writeFileSync(PLIST, plist());
  const r = launchctl("bootstrap", DOMAIN, PLIST);
  if (r.status !== 0) { console.error(`background: macOS refused to start it: ${r.stderr.trim() || `launchctl exited ${r.status}`}`); process.exit(1); }
  console.log(`background: on. It runs once now, then within a minute of every save to ${libraryName()}.
  macOS lists it as "eagle-refs" (System Settings > General > Login Items & Extensions).
  log:  ${LOG}
  stop: eagle-refs background off`);
} else if (sub === "off") {
  unload();
  rmSync(PLIST, { force: true });
  rmSync(dirname(APP), { recursive: true, force: true });
  if (loaded()) { console.error("background: macOS has not stopped it yet; run `eagle-refs background off` again."); process.exit(1); }
  console.log(`background: off. Nothing runs on save any more; your tags and notes stay in Eagle.`);
} else if (sub === "status") {
  console.log(loaded() ? `background: on (${LABEL})` : "background: off");
  if (existsSync(LOG)) {
    const lines = readFileSync(LOG, "utf8").trimEnd().split("\n");
    console.log(`last run, from ${LOG}:\n${lines.slice(-12).map((l) => `  ${l}`).join("\n")}`);
  }
} else {
  console.log("usage: eagle-refs background on | off | status");
  process.exit(1);
}
