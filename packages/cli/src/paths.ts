import { homedir, platform } from "node:os";
import { join } from "node:path";

export function appDir(): string {
  const home = homedir();
  if (platform() === "darwin") return join(home, "Library", "Application Support", "sponsorline");
  if (platform() === "win32") return join(process.env.APPDATA ?? home, "sponsorline");
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "sponsorline");
}
