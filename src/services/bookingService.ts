import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import { Env } from "../env";
import { getDb } from "../db";
import {
  bookings,
  bookingAvailability,
  bookingSettings,
  type Booking,
  type BookingAvailability,
  type BookingSettings,
} from "../db/schema";

export interface CreateBookingRequest {
  id?: string;
  propertyId: string;
  userId: string;
  ownerId: string;
  startTime: Date;
  endTime: Date;
  type: "viewing" | "inspection" | "reservation";
  notes?: string;
  status?: "pending" | "confirmed" | "completed" | "cancelled" | "declined";
}

export interface UpdateBookingRequest {
  status?: "pending" | "confirmed" | "completed" | "cancelled" | "declined";
  notes?: string;
  cancelledAt?: Date | null;
  paymentStatus?: "pending" | "paid" | "refunded" | "failed";
}

export interface BookingFilter {
  propertyId?: string;
  userId?: string;
  ownerId?: string;
  status?: string[];
  startDate?: Date;
  endDate?: Date;
}

export class BookingService {
  constructor(private env: Env) {}

  async createBooking(data: CreateBookingRequest): Promise<Booking> {
    const db = getDb(this.env);

    // Note: Availability checks are handled by the monolith
    // Since bookings are created in the monolith first (which validates availability),
    // we just store the booking locally without re-checking

    // Create the booking
    const [newBooking] = await db
      .insert(bookings)
      .values({
        id: data.id as string, // Use provided ID (from monolith)
        propertyId: data.propertyId,
        userId: data.userId,
        ownerId: data.ownerId,
        startTime: data.startTime.toISOString(),
        endTime: data.endTime.toISOString(),
        type: data.type,
        notes: data.notes,
        status: data.status || "pending", // Use provided status or default to pending
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();

    return newBooking;
  }

  async getBookingById(bookingId: string): Promise<Booking | null> {
    const db = getDb(this.env);

    const result = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    return result[0] || null;
  }

  async getBookings(filter: BookingFilter = {}): Promise<Booking[]> {
    const db = getDb(this.env);

    const conditions = [];

    if (filter.propertyId) {
      conditions.push(eq(bookings.propertyId, filter.propertyId));
    }

    if (filter.userId) {
      conditions.push(eq(bookings.userId, filter.userId));
    }

    if (filter.ownerId) {
      conditions.push(eq(bookings.ownerId, filter.ownerId));
    }

    if (filter.status && filter.status.length > 0) {
      conditions.push(
        or(
          ...filter.status.map((status) =>
            eq(
              bookings.status,
              status as
                | "pending"
                | "confirmed"
                | "completed"
                | "cancelled"
                | "declined",
            ),
          ),
        )!,
      );
    }

    if (filter.startDate) {
      conditions.push(gte(bookings.startTime, filter.startDate.toISOString()));
    }

    if (filter.endDate) {
      conditions.push(lte(bookings.endTime, filter.endDate.toISOString()));
    }

    const query = db.select().from(bookings);

    if (conditions.length > 0) {
      return await query.where(and(...conditions));
    }

    return await query;
  }

  async updateBooking(
    bookingId: string,
    data: UpdateBookingRequest,
  ): Promise<Booking | null> {
    const db = getDb(this.env);

    const updateData: any = { ...data };
    if (data.cancelledAt !== undefined) {
      updateData.cancelledAt = data.cancelledAt ? data.cancelledAt.toISOString() : null;
    }
    updateData.updatedAt = new Date().toISOString();

    const [updatedBooking] = await db
      .update(bookings)
      .set(updateData)
      .where(eq(bookings.id, bookingId))
      .returning();

    return updatedBooking || null;
  }

  async deleteBooking(bookingId: string): Promise<boolean> {
    const db = getDb(this.env);

    const deletedCount = await db
      .delete(bookings)
      .where(eq(bookings.id, bookingId));

    return deletedCount > 0;
  }

  async confirmBooking(bookingId: string): Promise<Booking | null> {
    return await this.updateBooking(bookingId, { status: "confirmed" });
  }

  async cancelBooking(bookingId: string): Promise<Booking | null> {
    return await this.updateBooking(bookingId, {
      status: "cancelled",
      cancelledAt: new Date(),
    });
  }

  async completeBooking(bookingId: string): Promise<Booking | null> {
    return await this.updateBooking(bookingId, {
      status: "completed",
      paymentStatus: "paid",
    });
  }

  private async checkAvailability(
    propertyId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<boolean> {
    const db = getDb(this.env);

    // Check for existing conflicting bookings
    const conflictingBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          eq(bookings.status, "confirmed"), // Only consider confirmed bookings
          lte(bookings.startTime, endTime), // Start time before or at end time
          gte(bookings.endTime, startTime), // End time after or at start time
        ),
      );

    if (conflictingBookings.length > 0) {
      return false; // Found conflicting booking
    }

    // Check availability schedule
    const availabilitySlots = await db
      .select()
      .from(bookingAvailability)
      .where(
        and(
          eq(bookingAvailability.propertyId, propertyId),
          eq(bookingAvailability.isAvailable, false), // Look for blocked times
          lte(bookingAvailability.availableStartTime, endTime),
          gte(bookingAvailability.availableEndTime, startTime),
        ),
      );

    return availabilitySlots.length === 0; // Available if no blocking slots exist
  }

  private async getPropertySettings(
    propertyId: string,
  ): Promise<BookingSettings | null> {
    const db = getDb(this.env);

    const results = await db
      .select()
      .from(bookingSettings)
      .where(eq(bookingSettings.propertyId, propertyId))
      .limit(1);

    return results[0] || null;
  }

  private validateBookingAgainstSettings(
    booking: CreateBookingRequest,
    settings: BookingSettings,
  ): void {
    // Check minimum advance notice
    const now = new Date();
    const timeUntilBooking = booking.startTime.getTime() - now.getTime();
    const hoursUntilBooking = timeUntilBooking / (1000 * 60 * 60);

    if (hoursUntilBooking < settings.minAdvanceNoticeHours!) {
      throw new Error(
        `Booking must be made at least ${settings.minAdvanceNoticeHours} hours in advance`,
      );
    }

    // Check maximum advance booking days
    const daysUntilBooking = timeUntilBooking / (1000 * 60 * 60 * 24);

    if (daysUntilBooking > settings.maxAdvanceBookingDays!) {
      throw new Error(
        `Booking cannot be made more than ${settings.maxAdvanceBookingDays} days in advance`,
      );
    }

    // Check duration
    const bookingDuration =
      (booking.endTime.getTime() - booking.startTime.getTime()) /
      (1000 * 60 * 60); // in hours

    if (bookingDuration > settings.maxDurationHours!) {
      throw new Error(
        `Booking duration cannot exceed ${settings.maxDurationHours} hours`,
      );
    }

    // Check booking window
    const bookingStartHour =
      booking.startTime.getHours() + booking.startTime.getMinutes() / 60;
    const [startHour, startMinute] = settings
      .bookingWindowStart!.split(":")
      .map(Number);
    const [endHour, endMinute] = settings
      .bookingWindowEnd!.split(":")
      .map(Number);
    const windowStart = startHour + startMinute / 60;
    const windowEnd = endHour + endMinute / 60;

    if (bookingStartHour < windowStart || bookingStartHour > windowEnd) {
      throw new Error(
        `Booking must be within property's available window: ${settings.bookingWindowStart} - ${settings.bookingWindowEnd}`,
      );
    }
  }

  private async updateAvailabilityForBooking(bookingId: string): Promise<void> {
    // In a real implementation, you might want to automatically block availability
    // when a booking is created, depending on your business requirements
    // This is just a placeholder for future implementation
  }
}
