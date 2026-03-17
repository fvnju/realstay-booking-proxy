import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../env";
import { BookingService } from "../services/bookingService";
import { SyncService } from "../services/syncService";

// Define the Hono app for bookings with environment type
const bookings = new Hono<{ Bindings: Env }>();

// Request schemas using Zod for validation
const createBookingSchema = z.object({
  propertyId: z.string().uuid(),
  userId: z.string().uuid(),
  ownerId: z.string().uuid(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  type: z.enum(["viewing", "inspection", "reservation"]),
  notes: z.string().optional(),
});

const updateBookingSchema = z.object({
  status: z
    .enum(["pending", "confirmed", "completed", "cancelled", "declined"])
    .optional(),
  notes: z.string().optional(),
});

const bookingFilterSchema = z.object({
  propertyId: z.string().optional(),
  userId: z.string().optional(),
  status: z.string().optional(), // Will be handled as array in the query
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// GET /bookings - List bookings with optional filters
bookings.get("/", zValidator("query", bookingFilterSchema), async (c) => {
  try {
    const bookingService = new BookingService(c.env);
    const { propertyId, userId, status, startDate, endDate } =
      c.req.valid("query");

    // Parse the status string into an array
    const statusArray = status ? status.split(",") : undefined;

    const bookings = await bookingService.getBookings({
      propertyId,
      userId,
      status: statusArray as
        | ("pending" | "confirmed" | "completed" | "cancelled" | "declined")[]
        | undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    return c.json({ success: true, data: bookings });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return c.json({ success: false, error: "Failed to fetch bookings" }, 500);
  }
});

// GET /bookings/:id - Get a specific booking
bookings.get("/:id", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const bookingService = new BookingService(c.env);

    const booking = await bookingService.getBookingById(bookingId);
    if (!booking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    return c.json({ success: true, data: booking });
  } catch (error) {
    console.error("Error fetching booking:", error);
    return c.json({ success: false, error: "Failed to fetch booking" }, 500);
  }
});

// POST /bookings - Create a new booking
bookings.post("/", zValidator("json", createBookingSchema), async (c) => {
  try {
    const data = c.req.valid("json");
    const bookingService = new BookingService(c.env);

    // Convert string dates to Date objects
    const bookingData = {
      ...data,
      startTime: new Date(data.startTime),
      endTime: new Date(data.endTime),
    };

    const newBooking = await bookingService.createBooking(bookingData);

    return c.json({ success: true, data: newBooking }, 201);
  } catch (error) {
    console.error("Error creating booking:", error);
    if (error instanceof Error) {
      return c.json({ success: false, error: error.message }, 400);
    }
    return c.json({ success: false, error: "Failed to create booking" }, 500);
  }
});

// PUT /bookings/:id - Update a booking
bookings.put("/:id", zValidator("json", updateBookingSchema), async (c) => {
  try {
    const bookingId = c.req.param("id");
    const data = c.req.valid("json");
    const bookingService = new BookingService(c.env);

    const updatedBooking = await bookingService.updateBooking(bookingId, data);
    if (!updatedBooking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    return c.json({ success: true, data: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    return c.json({ success: false, error: "Failed to update booking" }, 500);
  }
});

// DELETE /bookings/:id - Delete a booking
bookings.delete("/:id", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const bookingService = new BookingService(c.env);

    const deleted = await bookingService.deleteBooking(bookingId);
    if (!deleted) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    return c.json({ success: true, message: "Booking deleted successfully" });
  } catch (error) {
    console.error("Error deleting booking:", error);
    return c.json({ success: false, error: "Failed to delete booking" }, 500);
  }
});

// PATCH /bookings/:id/confirm - Confirm a booking
bookings.patch("/:id/confirm", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const bookingService = new BookingService(c.env);

    const confirmedBooking = await bookingService.confirmBooking(bookingId);
    if (!confirmedBooking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    return c.json({ success: true, data: confirmedBooking });
  } catch (error) {
    console.error("Error confirming booking:", error);
    return c.json({ success: false, error: "Failed to confirm booking" }, 500);
  }
});

// PATCH /bookings/:id/cancel - Cancel a booking
bookings.patch("/:id/cancel", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const bookingService = new BookingService(c.env);

    const cancelledBooking = await bookingService.cancelBooking(bookingId);
    if (!cancelledBooking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    return c.json({ success: true, data: cancelledBooking });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    return c.json({ success: false, error: "Failed to cancel booking" }, 500);
  }
});

// PATCH /bookings/:id/complete - Mark booking as completed
bookings.patch("/:id/complete", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const bookingService = new BookingService(c.env);

    const completedBooking = await bookingService.completeBooking(bookingId);
    if (!completedBooking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    return c.json({ success: true, data: completedBooking });
  } catch (error) {
    console.error("Error completing booking:", error);
    return c.json({ success: false, error: "Failed to complete booking" }, 500);
  }
});

// POST /api/bookings/sync/retry - Retry syncing all pending_sync bookings to the monolith
// Called by the mobile app periodically after connectivity is restored
bookings.post("/sync/retry", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json(
        { success: false, error: "Authorization header is required" },
        401,
      );
    }

    const userAccessToken = authHeader.replace("Bearer ", "");
    const bookingService = new BookingService(c.env);
    const syncService = new SyncService();

    const pending = await bookingService.getPendingSyncBookings();

    if (pending.length === 0) {
      return c.json({
        success: true,
        message: "Nothing to sync",
        total: 0,
        synced: 0,
        failed: 0,
      });
    }

    const results = await Promise.allSettled(
      pending.map((b) =>
        syncService.retrySingleBooking(b, userAccessToken, bookingService),
      ),
    );

    const synced = results.filter(
      (r) => r.status === "fulfilled" && r.value === "synced",
    ).length;

    const failed = results.filter(
      (r) => r.status === "fulfilled" && r.value === "failed",
    ).length;

    return c.json({
      success: true,
      total: pending.length,
      synced,
      failed,
    });
  } catch (error) {
    console.error("Error during sync retry:", error);
    return c.json({ success: false, error: "Sync retry failed" }, 500);
  }
});

export { bookings };
