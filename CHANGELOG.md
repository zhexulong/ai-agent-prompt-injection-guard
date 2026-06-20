# Changelog

## Unreleased

- Prepares the npm package name `aipig` while keeping `private: true` until the final publish decision.
- Switches package metadata to Apache-2.0 and includes `LICENSE` and `NOTICE`.
- Documents the npm user path first: install `aipig`, run `npx aipig init`, build the CLIProxyAPI plugin, inspect the install plan, then install.
- Validates a local `npm pack` tarball install in a clean project, including `aipig init`, `aipig build-plugin`, and `aipig cliproxy doctor`.

## v0.1.0 Source Release

- Adds the CLIProxyAPI response interceptor path for stripping confirmed response-text injections before Claude Code or OpenCode stores them for later model turns.
- Adds the `aipig` source CLI for config initialization, CLIProxyAPI doctor/diff/install/uninstall/restore, and plugin builds.
- Installs through CLIProxyAPI hot reload by default. CPA restart is no longer required for the normal install path.
- Promotes install, lifecycle, YAML patching, candidate fingerprinting, history replay, and adapter behavior checks into the formal test suite.
- Validated against a local real-chain CLIProxyAPI run for Claude and OpenCode response-text injection cleanup.

Known limits:

- This is a source release, not an npm package release.
- Windows install paths are implemented but still need validation on a real Windows host.
- Proxy tool-result injection coverage remains pending for the CLIProxyAPI path.
