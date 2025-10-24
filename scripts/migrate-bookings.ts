/**
 * Migration script to fetch bookings from the monolith and populate the local database
 *
 * Usage:
 *   MONOLITH_EMAIL=your@email.com MONOLITH_PASSWORD=yourpassword npm run migrate
 */

import {
  MonolithClient,
  MonolithBooking,
} from "../src/services/monolithClient";
import { db } from "../src/db/local";
import { bookings, type NewBooking } from "../src/db/schema";
import { v4 as uuidv4 } from "uuid";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

/**
 * Map monolith status to our schema status
 */
function mapStatus(
  monolithStatus: string,
): "pending" | "confirmed" | "completed" | "cancelled" | "declined" {
  const statusMap: Record<
    string,
    "pending" | "confirmed" | "completed" | "cancelled" | "declined"
  > = {
    PENDING: "pending",
    RESERVED: "confirmed",
    CONFIRMED: "confirmed",
    CANCELLED: "cancelled",
    COMPLETED: "completed",
  };
  return statusMap[monolithStatus] || "pending";
}

/**
 * Transform monolith booking to our schema
 */
function transformBooking(monolithBooking: MonolithBooking): NewBooking {
  const paymentStatus:
    | "pending"
    | "paid"
    | "refunded"
    | "failed"
    | null
    | undefined =
    monolithBooking.status === "RESERVED" ||
    monolithBooking.status === "CONFIRMED"
      ? "paid"
      : "pending";

  return {
    id: monolithBooking._id,
    propertyId: monolithBooking.listing_id,
    userId: monolithBooking.customer_id,
    ownerId: monolithBooking.property_owner_id,
    startTime: new Date(monolithBooking.start_date).toISOString(),
    endTime: new Date(monolithBooking.end_date).toISOString(),
    status: mapStatus(monolithBooking.status),
    type: "reservation" as const, // Default to reservation since monolith doesn't have type
    createdAt: new Date(monolithBooking.createdAt).toISOString(),
    updatedAt: monolithBooking.updatedAt
      ? new Date(monolithBooking.updatedAt).toISOString()
      : new Date(monolithBooking.createdAt).toISOString(),
    cancelledAt:
      monolithBooking.status === "CANCELLED"
        ? new Date(monolithBooking.updatedAt).toISOString()
        : null,
    notes: null,
    paymentStatus,
  };
}

/**
 * Main migration function
 */
async function migrateBookings() {
  console.log("🚀 Starting booking migration from monolith...\n");

  // Check for required environment variables
  const email = process.env.MONOLITH_EMAIL;
  const password = process.env.MONOLITH_PASSWORD;

  if (!email || !password) {
    console.error(
      "❌ Error: MONOLITH_EMAIL and MONOLITH_PASSWORD environment variables are required",
    );
    console.error(
      "Usage: MONOLITH_EMAIL=your@email.com MONOLITH_PASSWORD=yourpassword npm run migrate",
    );
    process.exit(1);
  }

  try {
    // Initialize monolith client
    console.log("🔐 Authenticating with monolith...");
    const monolithClient = new MonolithClient(email, password);
    await monolithClient.authenticate();
    console.log("✅ Authentication successful\n");

    // Fetch all bookings
    console.log("📥 Fetching all bookings from monolith...");
    const monolithBookings = await monolithClient.fetchAllBookings();
    console.log(`✅ Fetched ${monolithBookings.length} bookings\n`);

    // Transform and insert bookings
    console.log("🔄 Transforming and inserting bookings...");
    let insertedCount = 0;
    let errorCount = 0;

    for (const monolithBooking of monolithBookings) {
      try {
        const transformedBooking = transformBooking(monolithBooking);
        await db.insert(bookings).values(transformedBooking);
        insertedCount++;

        if (insertedCount % 10 === 0) {
          console.log(
            `  ↳ Inserted ${insertedCount}/${monolithBookings.length} bookings...`,
          );
        }
      } catch (error) {
        errorCount++;
        console.error(
          `  ⚠️  Error inserting booking ${monolithBooking._id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("✨ Migration completed!");
    console.log("=".repeat(50));
    console.log(`✅ Successfully inserted: ${insertedCount} bookings`);
    if (errorCount > 0) {
      console.log(`⚠️  Failed to insert: ${errorCount} bookings`);
    }
    console.log("=".repeat(50) + "\n");

    // Summary by status
    console.log("📊 Summary by status:");
    const summary = monolithBookings.reduce(
      (acc, booking) => {
        const status = mapStatus(booking.status);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    for (const [status, count] of Object.entries(summary)) {
      console.log(`  ${status}: ${count}`);
    }

    console.log("\n✅ Migration completed successfully!");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrateBookings();
