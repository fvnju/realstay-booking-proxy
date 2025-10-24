import type { D1Database } from "@cloudflare/workers-types";

// Define the environment interface for Cloudflare Workers
export interface Env {
  // D1 Database binding
  DB: D1Database;

  // Add other bindings as needed
  // MY_KV: KVNamespace;
  // MY_BUCKET: R2Bucket;
}
