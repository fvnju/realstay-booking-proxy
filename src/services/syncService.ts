/**
 * Service for synchronizing bookings with the monolith API
 */

import { Booking } from "../db/schema";

const MONOLITH_BASE_URL = "https://real-stay-api.onrender.com";

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
   * Sync a booking update to the monolith using the user's access token
   */
  async syncBookingUpdate(
    booking: Booking,
    userAccessToken: string,
  ): Promise<void> {
    try {
      // Map our status to monolith status
      const statusMap: Record<string, string> = {
        pending: "PENDING",
        confirmed: "CONFIRMED",
        completed: "COMPLETED",
        cancelled: "CANCELLED",
        declined: "CANCELLED",
      };

      const monolithStatus = statusMap[booking.status] || "PENDING";

      // Note: The monolith might need the original booking ID to update
      // For now, we'll log a warning since we don't store the monolith booking ID
      console.warn(
        `⚠️  Booking update sync for ${booking.id} - would need monolith booking ID to update`,
      );
      console.log(`   Status: ${booking.status} -> ${monolithStatus}`);

      // If you want to implement this fully, you'll need to:
      // 1. Store the monolith booking ID in your schema when creating bookings
      // 2. Use that ID to make an update request to the monolith
    } catch (error) {
      console.error(
        `❌ Failed to sync booking update ${booking.id} to monolith:`,
        error,
      );
      // Don't re-throw for updates - they're not critical
    }
  }
}
