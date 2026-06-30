import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { configDir } from "./config.js";

export type ProviderName = "anthropic" | "openai";

export interface Credentials {
  providerKeys: Partial<Record<ProviderName, string>>;
}

export async function readCredentials(): Promise<Credentials> {
  try {
    const raw = await readFile(credentialsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Credentials>;

    return { providerKeys: parsed.providerKeys ?? {} };
  } catch {
    return { providerKeys: {} };
  }
}

export async function writeCredentials(credentials: Credentials): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(credentialsPath(), `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(credentialsPath(), 0o600);
}

export async function setProviderKey(provider: ProviderName, key: string): Promise<void> {
  const credentials = await readCredentials();
  credentials.providerKeys[provider] = key;
  await writeCredentials(credentials);
}

export async function getProviderKey(provider: ProviderName): Promise<string | undefined> {
  const credentials = await readCredentials();
  return credentials.providerKeys[provider];
}

export async function clearProviderKeys(): Promise<void> {
  await writeCredentials({ providerKeys: {} });
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export async function promptSecret(label: string): Promise<string> {
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];

    for await (const chunk of stdin) {
      chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks).toString("utf8").trim();
  }

  return new Promise((resolve) => {
    const readline = createInterface({ input: stdin, output: stdout });
    // Suppress echo so the secret is not printed to the terminal.
    (readline as unknown as { _writeToOutput: (value: string) => void })._writeToOutput = () => {};
    stdout.write(label);
    readline.question("", (answer) => {
      readline.close();
      stdout.write("\n");
      resolve(answer.trim());
    });
  });
}
