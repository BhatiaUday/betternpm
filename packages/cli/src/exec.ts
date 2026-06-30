import { spawn } from "node:child_process";

export interface NpmExecRequest {
  packageSpec: string;
  commandArgs: string[];
}

export function buildNpmExecArgs(request: NpmExecRequest): string[] {
  return ["exec", "--yes", "--package", request.packageSpec, "--", ...request.commandArgs];
}

export function buildNpmPassthroughArgs(args: string[]): string[] {
  return args;
}

export async function runNpmExec(request: NpmExecRequest): Promise<number> {
  return runNpm(buildNpmExecArgs(request));
}

export async function runNpmPassthrough(args: string[]): Promise<number> {
  return runNpm(buildNpmPassthroughArgs(args));
}

async function runNpm(args: string[]): Promise<number> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }

      resolve(signal === "SIGINT" ? 130 : 1);
    });
  });
}
