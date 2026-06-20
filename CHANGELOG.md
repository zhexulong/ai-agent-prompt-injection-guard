# Changelog

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
