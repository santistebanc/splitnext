# Anti-slop provenance

- Source repository: https://github.com/dmmulroy/anti-slop.git
- Source revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Source path: `skills/install-anti-slop/assets/anti-slop/`
- Installed path: `tools/oxlint/anti-slop/`
- Installed through: the `install-anti-slop` skill's bundled installer

At installation time, every copied file matched the Skills Manager cached checkout
at the source revision above by SHA-256. This file was added after that comparison
to record project-local provenance.

## Intentional deviations

- The generic plugin at `index.ts` is registered.
- The bundled Effect plugin remains vendored but is not registered because this
  project does not directly depend on `effect`.
- No vendored rule implementation was modified.
