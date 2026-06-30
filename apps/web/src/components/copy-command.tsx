"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable in insecure contexts — fail silently.
    }
  };

  return (
    <div className="command-preview">
      <Terminal size={18} aria-hidden="true" />
      <code>{command}</code>
      <button
        type="button"
        className="copy-button"
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : "Copy command"}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
