import path from "node:path";

export interface Config {
  port: number;
  /** Folder holding the database and uploaded videos. Must be on a Railway Volume in production. */
  dataDir: string;
  /** True when dataDir is known to be a mounted Railway Volume (survives redeploys). */
  persistent: boolean;
  /** Set only when running on Railway without any volume configured. */
  warnings: string[];
  /** Optional shared password for the control panel/API. Unset = app runs open (local dev). */
  appPassword?: string;
}

/**
 * Resolve settings from environment variables.
 * DATA_DIR wins; otherwise Railway's auto-provided RAILWAY_VOLUME_MOUNT_PATH; otherwise ./data.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const portRaw = env.PORT ?? "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: "${portRaw}"`);
  }

  const explicit = env.DATA_DIR?.trim();
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const dataDir = path.resolve(explicit || volume || "data");

  const warnings: string[] = [];
  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);
  // If we're on Railway and no volume is attached, everything written is lost on redeploy.
  const persistent = !onRailway || Boolean(volume);
  if (!persistent) {
    warnings.push(
      "Running on Railway with no Volume attached: data and uploaded videos will be LOST on every redeploy. See README.",
    );
  }
  const appPassword = env.APP_PASSWORD || undefined;
  return { port, dataDir, persistent, warnings, appPassword };
}
