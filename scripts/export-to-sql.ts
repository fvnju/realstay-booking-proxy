/**
 * Export bookings from local SQLite to SQL format for D1 import
 *
 * Usage:
 *   bun run export-to-sql
 */

import { db } from "../src/db/local";
import { bookings } from "../src/db/schema";
import { writeFileSync } from "fs";

async function exportToSql() {
  console.log("📤 Exporting bookings to SQL format...\n");

  try {
    const allBookings = await db.select().from(bookings);

    if (allBookings.length === 0) {
      console.log("⚠️  No bookings found in local database");
      console.log("Run 'bun run migrate' first to populate bookings.db\n");
      return;
    }

    console.log(`Found ${allBookings.length} bookings to export\n`);

    // Generate INSERT statements
    const sqlStatements = allBookings.map(booking => {
      const values = [
        `'${booking.id}'`,
        `'${booking.propertyId}'`,
        `'${booking.userId}'`,
        `'${booking.ownerId}'`,
        `'${booking.startTime}'`,
        `'${booking.endTime}'`,
        `'${booking.status}'`,
        `'${booking.type}'`,
        `'${booking.createdAt}'`,
        booking.updatedAt ? `'${booking.updatedAt}'` : 'NULL',
        booking.cancelledAt ? `'${booking.cancelledAt}'` : 'NULL',
        booking.notes ? `'${booking.notes.replace(/'/g, "''")}'` : 'NULL',
        booking.paymentStatus ? `'${booking.paymentStatus}'` : 'NULL'
      ];

      return `INSERT INTO bookings (id, property_id, user_id, owner_id, start_time, end_time, status, type, created_at, updated_at, cancelled_at, notes, payment_status) VALUES (${values.join(', ')});`;
    });

    const sqlContent = [
      '-- Bookings data export',
      '-- Generated from local SQLite database',
      '-- To import: wrangler d1 execute realstay-bookings-db --file=bookings-export.sql --local',
      '',
      ...sqlStatements
    ].join('\n');

    writeFileSync('bookings-export.sql', sqlContent);

    console.log("✅ Export completed!");
    console.log("📁 File: bookings-export.sql");
    console.log("\nTo import to D1:");
    console.log("  Local:  bun x wrangler d1 execute realstay-bookings-db --file=bookings-export.sql --local");
    console.log("  Remote: bun x wrangler d1 execute realstay-bookings-db --file=bookings-export.sql --remote");
  } catch (error) {
    console.error("❌ Export failed:", error);
    process.exit(1);
  }
}

exportToSql();
