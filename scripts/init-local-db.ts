/**
 * Initialize local SQLite database with schema
 *
 * Usage:
 *   bun run init-db
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";

async function initDatabase() {
  console.log("🔨 Creating local SQLite database tables...\n");

  const dbPath = "bookings.db";
  const dbExists = existsSync(dbPath);

  if (dbExists) {
    console.log("⚠️  Database file already exists at bookings.db");
    console.log("   Tables will be created if they don't exist.\n");
  }

  const sqlite = new Database(dbPath);

  try {
    // Create bookings table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        cancelled_at TEXT,
        notes TEXT,
        payment_status TEXT DEFAULT 'pending'
      )
    `);

    // Create indexes
    // Note: Using regular indexes, not unique - monolith is source of truth for availability
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS status_idx
      ON bookings(status)
    `);

    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS property_idx
      ON bookings(property_id)
    `);

    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS user_idx
      ON bookings(user_id)
    `);

    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS owner_idx
      ON bookings(owner_id)
    `);

    // Create booking_availability table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS booking_availability (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL,
        available_start_time TEXT NOT NULL,
        available_end_time TEXT NOT NULL,
        is_available INTEGER NOT NULL DEFAULT 1,
        block_reason TEXT
      )
    `);

    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS availability_property_idx
      ON booking_availability(property_id, available_start_time, available_end_time)
    `);

    // Create booking_settings table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS booking_settings (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL,
        min_advance_notice_hours INTEGER DEFAULT 24,
        max_advance_booking_days INTEGER DEFAULT 365,
        booking_window_start TEXT DEFAULT '09:00',
        booking_window_end TEXT DEFAULT '18:00',
        max_duration_hours INTEGER DEFAULT 2,
        cancellation_policy TEXT DEFAULT '24_hours_before',
        created_at TEXT NOT NULL,
        updated_at TEXT
      )
    `);

    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS settings_property_idx
      ON booking_settings(property_id)
    `);

    console.log("✅ Database tables created successfully!\n");
    console.log("📁 Database file: bookings.db");
    console.log("\nYou can now run the migration:");
    console.log("  MONOLITH_EMAIL=your@email.com MONOLITH_PASSWORD=yourpass bun run migrate");
  } catch (error) {
    console.error("❌ Error creating tables:", error);
    process.exit(1);
  } finally {
    sqlite.close();
  }
}

initDatabase();
