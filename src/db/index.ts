import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { Env } from "../env";

// For Cloudflare Workers with D1
export function getDb(env: Env) {
  // In Cloudflare Workers, use the D1 database binding
  if (env.DB) {
    return drizzleD1(env.DB);
  }

  throw new Error("Database binding not found. Make sure DB is configured in wrangler.jsonc");
}
