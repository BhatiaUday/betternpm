import { setSession, type CliSession } from "./credentials.js";

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
  error?: string;
}

type DevicePollResponse =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "complete"; token: string; login: string }
  | { status: "error"; error: string };

export interface GithubLoginResult {
  login: string;
}

/**
 * Runs the GitHub OAuth device flow against the betternpm API: prints a one-time
 * code, opens the verification URL, polls until the user authorizes, then saves the
 * signed session token locally. The CLI never sees a GitHub token — only the final
 * betternpm session.
 */
export async function loginWithGithub(auditServerUrl: string): Promise<GithubLoginResult> {
  const base = auditServerUrl.replace(/\/$/, "");

  const startResponse = await fetch(`${base}/v1/auth/cli/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });

  if (!startResponse.ok) {
    const text = await startResponse.text().catch(() => "");
    throw new Error(githubStartError(startResponse.status, text));
  }

  const start = await startResponse.json() as DeviceStartResponse;

  if (!start.deviceCode || !start.userCode) {
    throw new Error(start.error ?? "The server did not start GitHub login.");
  }

  process.stdout.write(
    `\nTo sign in, open:\n  ${start.verificationUri}\n\nand enter the code:\n  ${start.userCode}\n\n`
  );

  await tryOpenBrowser(start.verificationUri);
  process.stdout.write("Waiting for authorization in your browser… (Ctrl+C to cancel)\n");

  const deadline = Date.now() + start.expiresIn * 1000;
  let interval = Math.max(start.interval, 1);

  while (Date.now() < deadline) {
    await delay(interval * 1000);

    const pollResponse = await fetch(`${base}/v1/auth/cli/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: start.deviceCode })
    });

    if (!pollResponse.ok) {
      // Transient server/network blip — keep polling until the code expires.
      continue;
    }

    const poll = await pollResponse.json() as DevicePollResponse;

    if (poll.status === "complete") {
      const session: CliSession = { token: poll.token, login: poll.login };
      await setSession(session);
      return { login: poll.login };
    }

    if (poll.status === "slow_down") {
      interval = Math.max(poll.interval, interval + 5);
      continue;
    }

    if (poll.status === "error") {
      throw new Error(poll.error);
    }
    // pending → keep polling
  }

  throw new Error("Login timed out. Run `betternpm login github` again.");
}

function githubStartError(status: number, body: string): string {
  if (status === 503) {
    return "GitHub login isn't configured on the audit server yet.";
  }

  if (body.toLowerCase().includes("device flow")) {
    return "GitHub device flow isn't enabled on the OAuth app. Enable it in the app settings, then retry.";
  }

  return `Could not start GitHub login (${status}). ${body}`.trim();
}

async function tryOpenBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Ignore — the user can open the printed URL manually.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
