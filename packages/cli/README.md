# Better npm CLI

Better npm is an early trust layer for npm tooling. `betternpx` and `bnpx` replace `npx` with inspect-before-exec behavior. `betternpm` and `bnpm` replace `npm`; ordinary npm commands pass through, while direct registry package specs in `install`/`i`/`add` are inspected before npm runs.

For now, prefer the installer script instead of installing from npm directly:

```sh
curl -fsSL https://betternpm.org/latest | sh
```

That path builds from the current Better npm source and links the command aliases:

- `betternpm`
- `bnpm`
- `betternpx`
- `bnpx`

The npm package exists so the CLI names can be claimed and tested while the trust flow is still being hardened.