import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class InitError extends Error {
  override name = "InitError";
}

export const STARTER_CONFIG = `# Leakproof: find the leaks a screenshot can't see.
# Each flow is plain English. Kane CLI runs it in a real browser and checks what users never see.

url: http://localhost:3000        # where your app runs
start: npm run dev                 # optional: how to start it (removed if your app is already running)
env: [APP_USER, APP_PASSWORD]      # test credentials, read from your environment, never written to reports

checks:
  vitals: { slow_ms: 1000 }        # a page, image or API request slower than this is a leak

flows:
  - name: home
    checks: [network, console, vitals]
    steps:
      - Open the home page and wait for the main content to appear

  - name: sign-in
    checks: [cookies, storage, env-leak]
    steps:
      - Open /login and sign in with username {{APP_USER}} and password {{APP_PASSWORD}}
      - Wait for the signed-in page to appear
`;

/** Write a starter leakproof.yml and ignore Leakproof's output folder. Never overwrites a config. */
export function runInit(dir: string): { configPath: string; gitignoreUpdated: boolean } {
  const configPath = join(dir, "leakproof.yml");
  if (existsSync(configPath)) throw new InitError(`${configPath} already exists. Edit it, or delete it and run init again.`);
  writeFileSync(configPath, STARTER_CONFIG);

  const ignorePath = join(dir, ".gitignore");
  const current = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  if (/^\.leakproof\/?$/m.test(current)) return { configPath, gitignoreUpdated: false };
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(ignorePath, `${current}${sep}.leakproof/\n`);
  return { configPath, gitignoreUpdated: true };
}
