/**
 * Local SQLite database for migrations and local development
 * DO NOT import this file in Worker code
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

// Initialize the database
const sqlite = new Database(
  process.env.NODE_ENV === "test" ? ":memory:" : "bookings.db"
);

export const db = drizzle(sqlite);
