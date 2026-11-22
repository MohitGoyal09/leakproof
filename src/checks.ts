import type { CheckId, Vitals } from "./types.js";

/** Checks whose browser capture resets every step, so they must be asserted in the step that causes the traffic. */
export const STEP_SCOPED: readonly CheckId[] = ["network", "console", "env-leak", "vitals"];
/** Checks that read current browser state, so the last step is enough. */
export const STATE_SCOPED: readonly CheckId[] = ["cookies", "storage"];

export interface AssertionContext {
  /** The app URL's hostname, no port: the app's own API on another port is not a leak. */
  appHostname: string;
  vitals: Vitals;
}

export interface CheckInfo {
  label: string;
  why: string;
}

export const CHECKS: Record<CheckId, CheckInfo> = {
  cookies: { label: "Cookie flags", why: "A session cookie without HttpOnly or Secure can be read by injected scripts or sent over plain HTTP." },
  storage: { label: "Secrets in storage", why: "Tokens, keys and auth state in localStorage or sessionStorage are readable by any script on the page." },
  network: { label: "Hidden server errors", why: "The page looks fine, but a request behind it is failing." },
  console: { label: "Console errors", why: "A user action throws an error the UI hides." },
  "env-leak": { label: "Environment leaks", why: "Production code is calling a staging, dev or internal host." },
  vitals: { label: "Slow requests", why: "A page, image or API request is slow enough for users to notice." },
};

/** Plain-English Kane assertion for a check. Wording proven in docs/kane-assertions.md; one condition per sentence. */
export function assertionFor(check: CheckId, ctx: AssertionContext): string {
  switch (check) {
    case "network":
      return "assert that no network request in this step returned a status of 500 or higher.";
    case "console":
      return "assert that there is no console message at level 'error' other than 'Failed to load resource' messages.";
    case "cookies":
      return "assert that at least one cookie is set. Then assert that no cookies are set without the HttpOnly flag. Then assert that no cookies are set without the Secure flag.";
    case "storage": {
      // One storage area per sentence: Kane checks only one condition per sentence. 'auth' catches auth state
      // kept for any script to read (the real app's `authState` passed the narrower list).
      const keys = "contains 'token', 'secret', 'api_key', 'auth', 'jwt' or 'password'";
      const values = "starts with 'sk_live_', 'sk_test_' or 'eyJ'";
      return [
        `assert that no localStorage key ${keys}.`,
        `Then assert that no sessionStorage key ${keys}.`,
        `Then assert that no localStorage value ${values}.`,
        `Then assert that no sessionStorage value ${values}.`,
      ].join(" ");
    }
    case "env-leak":
      return `assert that no network request in this step went to a host, other than ${ctx.appHostname} on any port, that contains 'staging', 'localhost', '127.0.0.1', 'dev.' or 'internal'.`;
    case "vitals":
      return `assert that every network request of type document, image, fetch or xhr in this step finished in under ${ctx.vitals.slowMs} ms.`;
  }
}
