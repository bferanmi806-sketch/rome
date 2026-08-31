import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import type { DrizzleDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { generateCaddyfile } from "./caddyfile-generator.js";
import { generateGatewayPage, getInstanceName } from "./gateway-page.js";
import type { PublicAccessConfig } from "./public-access-config.js";
import type { PublicAccessState } from "./public-access-state.js";

export { generateCaddyfile } from "./caddyfile-generator.js";

const log = createLogger("public-access");

function execFileAsync(command: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/** Loads the stored policy, updates the auth snapshot, and reconciles Caddy from that config. */
export async function reconcilePublicAccessAtStartup(
  db: DrizzleDb,
  publicAccessState: PublicAccessState,
): Promise<void> {
  const config = await publicAccessState.load(db);
  await writeCaddyfileAndReload(db, config);
}

export async function writeCaddyfileAndReload(
  db: DrizzleDb | null,
  config: PublicAccessConfig,
): Promise<void> {
  const caddyPath = process.env.CADDY_CONFIG_PATH || "/etc/caddy/Caddyfile";
  const content = generateCaddyfile(config);

  await writeFile(caddyPath, content, "utf-8");

  try {
    const instanceName = await getInstanceName(db);
    await generateGatewayPage(config, instanceName);
  } catch (err) {
    log.error("failed to generate gateway page", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await execFileAsync("caddy", ["reload", "--config", caddyPath], 10_000);
}
