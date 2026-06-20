# Changelog

## Unreleased

- Prepares the npm package name `aipig` while keeping `private: true` until the final publish decision.
- Switches package metadata to Apache-2.0 and includes `LICENSE` and `NOTICE`.
- Documents the npm user path first: install `aipig`, run `npx aipig init`, build the CLIProxyAPI plugin, inspect the install plan, then install.
- Validates a local `npm pack` tarball install in a clean project, including `aipig init`, `aipig build-plugin`, `aipig cliproxy doctor`, real CLIProxyAPI install with hot reload, and restore.
- Makes `aipig cliproxy doctor` human-readable by default while keeping `--json` for scripts.
- Adds clearer install recovery messages when the CLIProxyAPI plugin artifacts have not been built.
- Documents CLIProxyAPI compatibility expectations and common install recovery steps.
- Adds CLIProxyAPI version support checks to `doctor`: v7+ is required, `7.2.22` is the current verified baseline, and v6 builds fail fast.
- Adds CLIProxyAPI `request.intercept_before` handling for model-facing tool-result cleanup in upstream request bodies.
- Makes `aipig init` create a default project `fingerprints.json` when one is missing, so proxy plugins can run immediately after install.

## v0.1.0 Source Release

- Adds the CLIProxyAPI response interceptor path for stripping confirmed response-text injections before Claude Code or OpenCode stores them for later model turns.
- Adds the `aipig` source CLI for config initialization, CLIProxyAPI doctor/diff/install/uninstall/restore, and plugin builds.
- Installs through CLIProxyAPI hot reload by default. CPA restart is no longer required for the normal install path.
- Promotes install, lifecycle, YAML patching, candidate fingerprinting, history replay, and adapter behavior checks into the formal test suite.
- Validated against a local real-chain CLIProxyAPI run for Claude and OpenCode response-text injection cleanup.

Known limits:

- This is a source release, not an npm package release.
- Windows install paths are implemented but still need validation on a real Windows host.
- Real host tool-call eval remains pending for the CLIProxyAPI proxy tool-result path.
