/**
 * Service for synchronizing bookings with the monolith API
 */

import { Booking } from "../db/schema";
import { MONOLITH_BASE_URL } from "./monolithClient";
import { BookingService } from "./bookingService";

export type MonolithBookingResponse = {
  data: {
    _id: string;
    customer_id: string;
    property_owner_id: string;
    listing_id: string;
    start_date: string;
    end_date: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    __v: number;
  };
  success: boolean;
};

export class SyncService {
  /**
   * Create a new booking in the monolith using the user's access token
   * The monolith generates the booking ID and returns the full booking data
   */
  async createBookingInMonolith(
    propertyId: string,
    startTime: Date,
    endTime: Date,
    userAccessToken: string,
  ): Promise<MonolithBookingResponse> {
    try {
      // Format dates as YYYY-MM-DD for the monolith
      const formatDate = (date: Date) => {
        return date.toISOString().split("T")[0];
      };

      const response = await fetch(`${MONOLITH_BASE_URL}/bookings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          listing_id: propertyId,
          start_date: formatDate(startTime),
          end_date: formatDate(endTime),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to create booking in monolith: ${response.status} ${errorText}`,
        );
      }

      const data = (await response.json()) as MonolithBookingResponse;

      if (!data.success) {
        throw new Error("Monolith returned success: false");
      }

      console.log(
        `✅ Successfully created booking in monolith: ${data.data._id}`,
      );

      return data;
    } catch (error) {
      console.error(`❌ Failed to create booking in monolith:`, error);
      // Re-throw so the API can handle it
      throw error;
    }
  }

  /**
   * Sync a booking status update to the monolith using the user's access token.
   * Skips silently if the booking has not yet been synced (no monolithId).
   */
  async syncBookingUpdate(
    booking: Booking,
    userAccessToken: string,
  ): Promise<void> {
    if (!booking.monolithId) {
      console.warn(
        `⚠️  Skipping update sync for ${booking.id} — no monolithId yet`,
      );
      return;
    }

    const statusMap: Record<string, string> = {
      pending: "PENDING",
      confirmed: "CONFIRMED",
      completed: "COMPLETED",
      cancelled: "CANCELLED",
      declined: "CANCELLED",
    };

    const response = await fetch(
      `${MONOLITH_BASE_URL}/bookings/${booking.monolithId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: statusMap[booking.status] ?? "PENDING",
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Monolith update failed: ${response.status}`);
    }

    console.log(
      `✅ Synced booking update ${booking.id} → monolith ${booking.monolithId}`,
    );
  }

  /**
   * Retry pushing a single pending_sync booking to the monolith.
   * - 4xx response  → definitive failure: marks the booking as sync_failed
   * - 5xx / network → transient failure: leaves it as pending_sync for the next retry
   */
  async retrySingleBooking(
    booking: Booking,
    userAccessToken: string,
    bookingService: BookingService,
  ): Promise<"synced" | "failed"> {
    try {
      const formatDate = (d: string) => new Date(d).toISOString().split("T")[0];

      const response = await fetch(`${MONOLITH_BASE_URL}/bookings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          listing_id: booking.propertyId,
          start_date: formatDate(booking.startTime),
          end_date: formatDate(booking.endTime),
        }),
      });

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          // Definitive failure — monolith rejected the booking (e.g. 400, 409)
          await bookingService.markSyncFailed(booking.id);
          console.error(
            `❌ Booking ${booking.id} permanently rejected by monolith: ${response.status}`,
          );
        } else {
          // Transient failure (5xx) — leave as pending_sync for next retry
          console.warn(
            `⚠️  Transient monolith error for booking ${booking.id}: ${response.status} — will retry`,
          );
        }
        return "failed";
      }

      const data = (await response.json()) as MonolithBookingResponse;
      await bookingService.markAsSynced(booking.id, data.data._id);
      console.log(
        `✅ Retry synced booking ${booking.id} → monolith ${data.data._id}`,
      );
      return "synced";
    } catch (err) {
      // Network error / timeout — transient, leave as pending_sync
      console.error(`❌ Network error retrying booking ${booking.id}:`, err);
      return "failed";
    }
  }
}
