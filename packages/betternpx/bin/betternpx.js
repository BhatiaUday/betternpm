#!/usr/bin/env node
console.error(`betternpx is reserved for Better npm.

Install the current CLI with:
	curl -fsSL https://betternpm.org/latest | sh

Then run:
	betternpx ${process.argv.slice(2).join(" ")}`.trim());
process.exitCode = 1;