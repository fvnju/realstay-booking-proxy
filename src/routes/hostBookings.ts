import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../env";
import { BookingService } from "../services/bookingService";
import { SyncService } from "../services/syncService";

// Define the Hono app for host bookings
const hostBookings = new Hono<{ Bindings: Env }>();

// Request schemas using Zod for validation
const bookingFilterSchema = z.object({
  ownerId: z.string(),
  propertyId: z.string().optional(),
  status: z.string().optional(), // Comma-separated list
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const updateBookingStatusSchema = z.object({
  status: z.enum(["confirmed", "declined"]),
});

// GET /api/hosts/bookings - List bookings for a specific host/property owner
hostBookings.get("/", zValidator("query", bookingFilterSchema), async (c) => {
  try {
    const bookingService = new BookingService(c.env);
    const { ownerId, propertyId, status, startDate, endDate } =
      c.req.valid("query");

    // Parse the status string into an array
    const statusArray = status ? status.split(",") : undefined;

    const bookings = await bookingService.getBookings({
      ownerId, // Required for host bookings - filter by property owner
      propertyId,
      status: statusArray as
        | ("pending" | "confirmed" | "completed" | "cancelled" | "declined")[]
        | undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    return c.json({ success: true, data: bookings });
  } catch (error) {
    console.error("Error fetching host bookings:", error);
    return c.json(
      { success: false, error: "Failed to fetch host bookings" },
      500,
    );
  }
});

// GET /api/hosts/bookings/:id - Get a specific booking for a host
hostBookings.get("/:id", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const ownerId = c.req.query("ownerId");

    if (!ownerId) {
      return c.json(
        { success: false, error: "ownerId query parameter is required" },
        400,
      );
    }

    const bookingService = new BookingService(c.env);
    const booking = await bookingService.getBookingById(bookingId);

    if (!booking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Verify the booking belongs to a property owned by this host
    if (booking.ownerId !== ownerId) {
      return c.json(
        { success: false, error: "Unauthorized access to this booking" },
        403,
      );
    }

    return c.json({ success: true, data: booking });
  } catch (error) {
    console.error("Error fetching host booking:", error);
    return c.json(
      { success: false, error: "Failed to fetch host booking" },
      500,
    );
  }
});

// PATCH /api/hosts/bookings/:id/confirm - Confirm a booking as a host
hostBookings.patch("/:id/confirm", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const ownerId = c.req.query("ownerId");

    if (!ownerId) {
      return c.json(
        { success: false, error: "ownerId query parameter is required" },
        400,
      );
    }

    const bookingService = new BookingService(c.env);
    const booking = await bookingService.getBookingById(bookingId);

    if (!booking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Verify the booking belongs to a property owned by this host
    if (booking.ownerId !== ownerId) {
      return c.json(
        { success: false, error: "Unauthorized to confirm this booking" },
        403,
      );
    }

    const confirmedBooking = await bookingService.confirmBooking(bookingId);

    // Sync to monolith (optional - updates are not critical)
    if (confirmedBooking) {
      const authHeader = c.req.header("Authorization");
      if (authHeader) {
        const userAccessToken = authHeader.replace("Bearer ", "");
        const syncService = new SyncService();
        syncService
          .syncBookingUpdate(confirmedBooking, userAccessToken)
          .catch((err) => {
            console.error("Sync update failed:", err);
          });
      }
    }

    return c.json({ success: true, data: confirmedBooking });
  } catch (error) {
    console.error("Error confirming host booking:", error);
    return c.json(
      { success: false, error: "Failed to confirm host booking" },
      500,
    );
  }
});

// PATCH /api/hosts/bookings/:id/decline - Decline a booking as a host
hostBookings.patch("/:id/decline", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const ownerId = c.req.query("ownerId");

    if (!ownerId) {
      return c.json(
        { success: false, error: "ownerId query parameter is required" },
        400,
      );
    }

    const bookingService = new BookingService(c.env);
    const booking = await bookingService.getBookingById(bookingId);

    if (!booking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Verify the booking belongs to a property owned by this host
    if (booking.ownerId !== ownerId) {
      return c.json(
        { success: false, error: "Unauthorized to decline this booking" },
        403,
      );
    }

    // Update booking status to declined
    const declinedBooking = await bookingService.updateBooking(bookingId, {
      status: "declined",
    });

    // Sync to monolith (optional - updates are not critical)
    if (declinedBooking) {
      const authHeader = c.req.header("Authorization");
      if (authHeader) {
        const userAccessToken = authHeader.replace("Bearer ", "");
        const syncService = new SyncService();
        syncService
          .syncBookingUpdate(declinedBooking, userAccessToken)
          .catch((err) => {
            console.error("Sync update failed:", err);
          });
      }
    }

    return c.json({ success: true, data: declinedBooking });
  } catch (error) {
    console.error("Error declining host booking:", error);
    return c.json(
      { success: false, error: "Failed to decline host booking" },
      500,
    );
  }
});

// PATCH /api/hosts/bookings/:id/complete - Mark a booking as completed (for host)
hostBookings.patch("/:id/complete", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const ownerId = c.req.query("ownerId");

    if (!ownerId) {
      return c.json(
        { success: false, error: "ownerId query parameter is required" },
        400,
      );
    }

    const bookingService = new BookingService(c.env);
    const booking = await bookingService.getBookingById(bookingId);

    if (!booking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Verify the booking belongs to a property owned by this host
    if (booking.ownerId !== ownerId) {
      return c.json(
        { success: false, error: "Unauthorized to complete this booking" },
        403,
      );
    }

    const completedBooking = await bookingService.completeBooking(bookingId);

    // Sync to monolith (optional - updates are not critical)
    if (completedBooking) {
      const authHeader = c.req.header("Authorization");
      if (authHeader) {
        const userAccessToken = authHeader.replace("Bearer ", "");
        const syncService = new SyncService();
        syncService
          .syncBookingUpdate(completedBooking, userAccessToken)
          .catch((err) => {
            console.error("Sync update failed:", err);
          });
      }
    }

    return c.json({ success: true, data: completedBooking });
  } catch (error) {
    console.error("Error completing host booking:", error);
    return c.json(
      { success: false, error: "Failed to complete host booking" },
      500,
    );
  }
});

export { hostBookings };
