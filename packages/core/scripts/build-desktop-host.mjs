import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export function buildDesktopHost() {
  if (process.platform !== "win32") return;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const compiler = join(process.env.WINDIR || "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  if (!existsSync(compiler)) throw new Error("The Windows .NET Framework C# compiler is required for DesktopHost.");
  const output = join(root, "out/native/DesktopHost.exe");
  mkdirSync(dirname(output), { recursive: true });
  execFileSync(compiler, ["/nologo", "/target:exe", "/platform:x64", "/optimize+", "/r:System.Windows.Forms.dll", `/out:${output}`, join(root, "native/DesktopHost.cs")], { stdio: "pipe", windowsHide: true });
}
