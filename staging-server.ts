import { loadEnvFile } from "node:process";
import { startStagingServer } from "./src/staging-server.js";

try {
  loadEnvFile(".env.staging");
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code !== "ENOENT") throw error;
}

startStagingServer(process.env);
