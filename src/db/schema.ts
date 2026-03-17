import { sql } from "drizzle-orm";
import {
  sqliteTableCreator,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

const sqliteTable = sqliteTableCreator((name) => name);

// Bookings table
export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id").notNull(),
    userId: text("user_id").notNull(),
    ownerId: text("owner_id").notNull(),
    startTime: text("start_time").notNull(), // ISO 8601 string
    endTime: text("end_time").notNull(), // ISO 8601 string
    status: text("status", {
      enum: ["pending", "confirmed", "completed", "cancelled", "declined"],
    })
      .$default(() => "pending")
      .notNull(),
    type: text("type", {
      enum: ["viewing", "inspection", "reservation"],
    }).notNull(),
    createdAt: text("created_at").notNull(), // ISO 8601 string
    updatedAt: text("updated_at"), // ISO 8601 string
    cancelledAt: text("cancelled_at"), // ISO 8601 string
    notes: text("notes"),
    paymentStatus: text("payment_status", {
      enum: ["pending", "paid", "refunded", "failed"],
    }).$default(() => "pending"),
    monolithId: text("monolith_id"),
    syncStatus: text("sync_status", {
      enum: ["synced", "pending_sync", "sync_failed"],
    })
      .notNull()
      .default("pending_sync"),
  },
  (table) => ({
    // Removed unique constraints on property/user + time slots
    // The monolith is the source of truth for availability validation
    // We're just a read cache with role-based filtering
    statusIdx: index("status_idx").on(table.status),
    propertyIdx: index("property_idx").on(table.propertyId),
    userIdx: index("user_idx").on(table.userId),
    ownerIdx: index("owner_idx").on(table.ownerId),
    syncStatusIdx: index("sync_status_idx").on(table.syncStatus),
  }),
);

// Booking availability table
export const bookingAvailability = sqliteTable(
  "booking_availability",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id").notNull(),
    availableStartTime: text("available_start_time").notNull(), // ISO 8601 string
    availableEndTime: text("available_end_time").notNull(), // ISO 8601 string
    isAvailable: integer("is_available", { mode: "boolean" })
      .notNull()
      .default(true),
    blockReason: text("block_reason"),
  },
  (table) => ({
    availabilityPropertyIdx: uniqueIndex("availability_property_idx").on(
      table.propertyId,
      table.availableStartTime,
      table.availableEndTime,
    ),
  }),
);

// Booking settings table
export const bookingSettings = sqliteTable(
  "booking_settings",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id").notNull(),
    minAdvanceNoticeHours: integer("min_advance_notice_hours").default(24),
    maxAdvanceBookingDays: integer("max_advance_booking_days").default(365),
    bookingWindowStart: text("booking_window_start").default("09:00"),
    bookingWindowEnd: text("booking_window_end").default("18:00"),
    maxDurationHours: integer("max_duration_hours").default(2),
    cancellationPolicy: text("cancellation_policy").default("24_hours_before"),
    createdAt: text("created_at").notNull(), // ISO 8601 string
    updatedAt: text("updated_at"), // ISO 8601 string
  },
  (table) => ({
    settingsPropertyIdx: uniqueIndex("settings_property_idx").on(
      table.propertyId,
    ),
  }),
);

// Export types
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingAvailability = typeof bookingAvailability.$inferSelect;
export type NewBookingAvailability = typeof bookingAvailability.$inferInsert;
export type BookingSettings = typeof bookingSettings.$inferSelect;
export type NewBookingSettings = typeof bookingSettings.$inferInsert;
