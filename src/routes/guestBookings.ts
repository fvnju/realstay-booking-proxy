import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../env";
import { BookingService } from "../services/bookingService";
import { SyncService } from "../services/syncService";
import { MonolithClient } from "../services/monolithClient";

// Define the Hono app for guest bookings
const guestBookings = new Hono<{ Bindings: Env }>();

// Request schemas using Zod for validation
const createBookingSchema = z.object({
  propertyId: z.string(),
  userId: z.string(),
  ownerId: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  type: z.enum(["viewing", "inspection", "reservation"]),
  notes: z.string().optional(),
});

const bookingFilterSchema = z.object({
  userId: z.string().min(1),
  propertyId: z.string().optional(),
  status: z.string().optional(), // Comma-separated list
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const paymentSchema = z.object({
  transactionRef: z.string().min(1),
  bookingId: z.string().min(1),
});

// GET /api/guests/bookings - List bookings for a specific guest
guestBookings.get("/", zValidator("query", bookingFilterSchema), async (c) => {
  try {
    const bookingService = new BookingService(c.env);
    const { userId, propertyId, status, startDate, endDate } =
      c.req.valid("query");

    // Parse the status string into an array
    const statusArray = status ? status.split(",") : undefined;

    const bookings = await bookingService.getBookings({
      userId, // Required for guest bookings
      propertyId,
      status: statusArray as
        | ("pending" | "confirmed" | "completed" | "cancelled" | "declined")[]
        | undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    return c.json({ success: true, data: bookings });
  } catch (error) {
    console.error("Error fetching guest bookings:", error);
    return c.json(
      { success: false, error: "Failed to fetch guest bookings" },
      500,
    );
  }
});

// GET /api/guests/bookings/:id - Get a specific booking for a guest
guestBookings.get("/:id", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const userId = c.req.query("userId");

    if (!userId) {
      return c.json(
        { success: false, error: "userId query parameter is required" },
        400,
      );
    }

    const bookingService = new BookingService(c.env);
    const booking = await bookingService.getBookingById(bookingId);

    if (!booking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Verify the booking belongs to the user
    if (booking.userId !== userId) {
      return c.json(
        { success: false, error: "Unauthorized access to this booking" },
        403,
      );
    }

    return c.json({ success: true, data: booking });
  } catch (error) {
    console.error("Error fetching guest booking:", error);
    return c.json(
      { success: false, error: "Failed to fetch guest booking" },
      500,
    );
  }
});

// POST /api/guests/bookings - Create a new booking as a guest
guestBookings.post("/", zValidator("json", createBookingSchema), async (c) => {
  try {
    const data = c.req.valid("json");
    const bookingService = new BookingService(c.env);

    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json(
        {
          success: false,
          error: "Authorization header is required for syncing to monolith",
        },
        401,
      );
    }

    const userAccessToken = authHeader.replace("Bearer ", "");
    const startTime = new Date(data.startTime);
    const endTime = new Date(data.endTime);

    // Generate a stable local ID before attempting monolith sync
    const localId = crypto.randomUUID();
    let monolithId: string | null = null;
    let syncStatus: "synced" | "pending_sync" = "pending_sync";

    try {
      const syncService = new SyncService();
      const monolithResponse = await syncService.createBookingInMonolith(
        data.propertyId,
        startTime,
        endTime,
        userAccessToken,
      );
      monolithId = monolithResponse.data._id;
      syncStatus = "synced";
    } catch (syncError) {
      console.warn(
        "Monolith unavailable — booking will be created locally as pending_sync:",
        syncError instanceof Error ? syncError.message : syncError,
      );
    }

    const bookingData = {
      id: localId,
      monolithId: monolithId ?? undefined,
      syncStatus,
      propertyId: data.propertyId,
      userId: data.userId,
      ownerId: data.ownerId,
      startTime,
      endTime,
      type: data.type,
      notes: data.notes,
      status: "pending" as const,
    };

    const newBooking = await bookingService.createBooking(bookingData);

    const responsePayload: Record<string, unknown> = {
      success: true,
      data: newBooking,
    };

    if (syncStatus === "pending_sync") {
      responsePayload.warning =
        "Booking saved locally but could not reach the main server. It will sync automatically.";
    }

    return c.json(responsePayload, 201);
  } catch (error) {
    console.error("Error creating guest booking:", error);
    if (error instanceof Error) {
      return c.json({ success: false, error: error.message }, 400);
    }
    return c.json(
      { success: false, error: "Failed to create guest booking" },
      500,
    );
  }
});

// PATCH /api/guests/bookings/:id/cancel - Cancel a booking as a guest
guestBookings.patch("/:id/cancel", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const userId = c.req.query("userId");

    if (!userId) {
      return c.json(
        { success: false, error: "userId query parameter is required" },
        400,
      );
    }

    const bookingService = new BookingService(c.env);
    const booking = await bookingService.getBookingById(bookingId);

    if (!booking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Verify the booking belongs to the user
    if (booking.userId !== userId) {
      return c.json(
        { success: false, error: "Unauthorized to cancel this booking" },
        403,
      );
    }

    const cancelledBooking = await bookingService.cancelBooking(bookingId);

    // Sync to monolith (optional - updates are not critical)
    if (cancelledBooking) {
      const authHeader = c.req.header("Authorization");
      if (authHeader) {
        const userAccessToken = authHeader.replace("Bearer ", "");
        const syncService = new SyncService();
        syncService
          .syncBookingUpdate(cancelledBooking, userAccessToken)
          .catch((err) => {
            console.error("Sync update failed:", err);
          });
      }
    }

    return c.json({ success: true, data: cancelledBooking });
  } catch (error) {
    console.error("Error cancelling guest booking:", error);
    return c.json(
      { success: false, error: "Failed to cancel guest booking" },
      500,
    );
  }
});

// POST /api/guests/bookings/payment - Set payment data
guestBookings.post("/payment", zValidator("json", paymentSchema), async (c) => {
  try {
    const data = c.req.valid("json");
    const bookingService = new BookingService(c.env);

    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json(
        {
          success: false,
          error: "Authorization header is required for syncing to monolith",
        },
        401,
      );
    }

    const userAccessToken = authHeader.replace("Bearer ", "");

    // Guard: fetch booking first to check sync state
    const existingBooking = await bookingService.getBookingById(data.bookingId);
    if (!existingBooking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Cannot process payment for a booking that hasn't reached the monolith yet
    if (!existingBooking.monolithId) {
      return c.json(
        {
          success: false,
          error:
            "This booking has not yet synced to the main server. Please try again shortly.",
          syncStatus: existingBooking.syncStatus,
        },
        409,
      );
    }

    // Mark booking as completed locally
    const booking = await bookingService.completeBooking(data.bookingId);

    // Sync payment to monolith
    try {
      const monolithService = new MonolithClient();
      await monolithService.setPayment(data, userAccessToken);
    } catch (error) {
      console.error("Setting payment data in Monolith failed:", error);
      return c.json(
        {
          success: true,
          data: booking,
          message:
            "Payment was acknowledged locally but couldn't sync to the main server." as const,
        },
        201,
      );
    }

    return c.json({ success: true, data: booking }, 201);
  } catch (error) {
    console.error("Error setting payment data:", error);
    if (error instanceof Error) {
      return c.json({ success: false, error: error.message }, 400);
    }
    return c.json({ success: false, error: "Failed to set payment" }, 500);
  }
});

// GET /api/guests/bookings/:id/review-eligibility - Check if user can write a review for a booking
guestBookings.get("/:id/review-eligibility", async (c) => {
  try {
    const bookingId = c.req.param("id");
    const userId = c.req.query("userId");

    if (!userId) {
      return c.json(
        { success: false, error: "userId query parameter is required" },
        400,
      );
    }

    const bookingService = new BookingService(c.env);
    const booking = await bookingService.getBookingById(bookingId);

    if (!booking) {
      return c.json({ success: false, error: "Booking not found" }, 404);
    }

    // Verify the booking belongs to the user
    if (booking.userId !== userId) {
      return c.json(
        { success: false, error: "Unauthorized access to this booking" },
        403,
      );
    }

    // Check eligibility criteria
    const isCompleted = booking.status === "completed";
    const hasEnded = new Date(booking.endTime) < new Date();
    const isEligible = isCompleted && hasEnded;

    return c.json({
      success: true,
      data: {
        eligible: isEligible,
        booking: {
          id: booking.id,
          propertyId: booking.propertyId,
          status: booking.status,
          endTime: booking.endTime,
        },
        reasons: !isEligible
          ? [
              !isCompleted && "Booking must be completed",
              !hasEnded && "Booking end time has not passed yet",
            ].filter(Boolean)
          : [],
      },
    });
  } catch (error) {
    console.error("Error checking review eligibility:", error);
    return c.json(
      { success: false, error: "Failed to check review eligibility" },
      500,
    );
  }
});

export { guestBookings };
