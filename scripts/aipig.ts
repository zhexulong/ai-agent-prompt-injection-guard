import { spawnSync } from "node:child_process";
import { runAipigCli } from "../src/cli/aipig";

const result = await runAipigCli(Bun.argv.slice(2), {
  spawnBuild: () => {
    const js = spawnSync(process.execPath, ["run", "build"], {
      stdio: "inherit",
    });
    if ((js.status ?? 1) !== 0) return js.status ?? 1;
    const native = spawnSync(process.execPath, ["run", "scripts/build-cliproxy-plugin.ts"], {
      stdio: "inherit",
    });
    return native.status ?? 1;
  },
});

if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
if (result.stderr) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
process.exit(result.status);
