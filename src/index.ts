import { Hono } from "hono";
import { Env } from "./env";
import { bookings } from "./routes/bookings";
import { guestBookings } from "./routes/guestBookings";
import { hostBookings } from "./routes/hostBookings";

// Define the main app with environment type
const app = new Hono<{ Bindings: Env }>();

// Main health check endpoint
app.get("/", (c) => {
  return c.text("RealStay Bookings API - Hello Hono!");
});

// Mount the new guest and host booking routes
app.route("/api/guests/bookings", guestBookings);
app.route("/api/hosts/bookings", hostBookings);

// Keep the old bookings routes for backward compatibility (optional)
app.route("/api/bookings", bookings);

export default app;
