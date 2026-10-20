import { spawnSync } from "node:child_process";

function runNpm(args) {
  const isWindows = process.platform === "win32";
  const result = spawnSync(
    isWindows ? process.env.ComSpec || "cmd.exe" : "npm",
    isWindows ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args,
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const sheetDbProjectId = "prj_KOCjBgRv1VyX9WKlYtmSzT3U0AsL";
if (
  process.env.VERCEL === "1" &&
  process.env.VERCEL_ENV === "production" &&
  process.env.VERCEL_PROJECT_ID === sheetDbProjectId
) {
  runNpm(["run", "db:deploy"]);
}

runNpm(["run", "build"]);
