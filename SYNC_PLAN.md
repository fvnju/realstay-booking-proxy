# Sync Plan: `monolithId`, `syncStatus`, and Offline-First Booking Creation

## Overview

Currently, booking creation **hard-depends** on the monolith being available.
If the monolith is down, the entire request fails and nothing is saved locally.

This plan decouples booking creation from the monolith by:
1. Generating a **local UUID** as the stable booking identity
2. Storing the monolith's ID in a separate **`monolithId`** field (nullable until synced)
3. Tracking sync state with a **`syncStatus`** field
4. Retrying unsynced bookings when the monolith is reachable again — triggered by the mobile app

---

## Important: Existing Data

All bookings currently in the database were created via the monolith-first flow,
meaning the `id` column **already holds the monolith's `_id`**. For these rows:

- `monolithId` should be **backfilled with the current `id` value**
- `syncStatus` should be set to **`"synced"`** — they are already known to the monolith
- The `id` column stays exactly the same — no existing references break

Only **new bookings** created after this migration is applied will use a locally
generated UUID as their `id`, with `monolithId` being null until synced.

---

## Affected Files

| File | Change Type |
|------|-------------|
| `src/db/schema.ts` | Add `monolithId` + `syncStatus` columns |
| `src/services/bookingService.ts` | Update interfaces + add sync-aware methods |
| `src/services/syncService.ts` | Use `monolithId` in updates, add retry logic |
| `src/routes/guestBookings.ts` | Offline-first create, guard payment on sync |
| `src/routes/hostBookings.ts` | No changes needed — fixed via `syncService` |
| `src/routes/bookings.ts` | Required retry endpoint for mobile app |
| `migrations/` | New migration for schema + data backfill |

---

## Step 1 — Update the Database Schema

**File:** `src/db/schema.ts`

### 1.1 Add two new columns to the `bookings` table

```ts
monolithId: text("monolith_id"),   // nullable — null until synced with monolith
syncStatus: text("sync_status", {
  enum: ["synced", "pending_sync", "sync_failed"],
}).notNull().default("pending_sync"),
```

### 1.2 Add an index on `syncStatus` for efficient retry queries

```ts
syncStatusIdx: index("sync_status_idx").on(table.syncStatus),
```

### 1.3 Update the exported types

The `Booking` type is auto-inferred from the table definition via `$inferSelect`,
so `monolithId` and `syncStatus` will appear automatically after the schema change.
No manual type edits needed here.

### Full columns list after change

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | Stable booking identity — never changes after creation |
| `monolithId` | `text` nullable | Monolith's `_id` — populated after first successful sync |
| `syncStatus` | `text` enum | `"pending_sync"` → `"synced"` or `"sync_failed"` |
| *(all existing columns)* | — | Unchanged |

---

## Step 2 — Create a Migration

**File:** `migrations/XXXX_add_monolith_sync_fields.sql`

This migration does three things:
1. Adds the new columns
2. **Backfills all existing rows** — their `id` IS the monolith ID, so copy it across and mark them as synced
3. Adds the index

```sql
-- Add new columns
ALTER TABLE bookings ADD COLUMN monolith_id TEXT;
ALTER TABLE bookings ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending_sync';

-- Backfill existing rows:
-- Their `id` was always the monolith's _id, so mirror it into monolith_id
-- and mark them as already synced so they are never queued for retry
UPDATE bookings
SET monolith_id = id,
    sync_status = 'synced';

-- Index for efficient pending_sync queries (used by the retry endpoint)
CREATE INDEX sync_status_idx ON bookings (sync_status);
```

> Run via: `bun run db:migrate` (or equivalent script in `package.json`)

---

## Step 3 — Update `BookingService`

**File:** `src/services/bookingService.ts`

### 3.1 Update `CreateBookingRequest`

- Make `id` **optional** — if not provided, a UUID is generated locally
- Add `monolithId?: string` — set when the monolith responds successfully
- Add `syncStatus?: "synced" | "pending_sync" | "sync_failed"` — defaults to `"pending_sync"`

```ts
export interface CreateBookingRequest {
  id?: string;              // Optional — UUID generated locally if omitted
  monolithId?: string;      // Monolith's _id — null at creation if monolith was down
  syncStatus?: "synced" | "pending_sync" | "sync_failed";
  propertyId: string;
  userId: string;
  ownerId: string;
  startTime: Date;
  endTime: Date;
  type: "viewing" | "inspection" | "reservation";
  notes?: string;
  status?: "pending" | "confirmed" | "completed" | "cancelled" | "declined";
}
```

### 3.2 Update `createBooking` to generate a local UUID

```ts
async createBooking(data: CreateBookingRequest): Promise<Booking> {
  const db = getDb(this.env);

  const [newBooking] = await db
    .insert(bookings)
    .values({
      id: data.id ?? crypto.randomUUID(),  // Generate local ID if not provided
      monolithId: data.monolithId ?? null,
      syncStatus: data.syncStatus ?? "pending_sync",
      // ... rest of fields unchanged
    })
    .returning();

  return newBooking;
}
```

### 3.3 Update `UpdateBookingRequest`

Add the two new fields so they can be patched post-creation:

```ts
export interface UpdateBookingRequest {
  status?: "pending" | "confirmed" | "completed" | "cancelled" | "declined";
  notes?: string;
  cancelledAt?: Date | null;
  paymentStatus?: "pending" | "paid" | "refunded" | "failed";
  monolithId?: string;                                          // NEW
  syncStatus?: "synced" | "pending_sync" | "sync_failed";      // NEW
}
```

### 3.4 Add `markAsSynced` method

Called after a successful sync to write the monolith's ID and flip `syncStatus`:

```ts
async markAsSynced(localBookingId: string, monolithId: string): Promise<Booking | null> {
  return await this.updateBooking(localBookingId, {
    monolithId,
    syncStatus: "synced",
  });
}
```

### 3.5 Add `markSyncFailed` method

Called when a sync attempt definitively fails (not just a transient network error):

```ts
async markSyncFailed(localBookingId: string): Promise<Booking | null> {
  return await this.updateBooking(localBookingId, {
    syncStatus: "sync_failed",
  });
}
```

### 3.6 Add `getPendingSyncBookings` method

Used by the retry mechanism to find all bookings that haven't reached the monolith yet:

```ts
async getPendingSyncBookings(): Promise<Booking[]> {
  const db = getDb(this.env);
  return await db
    .select()
    .from(bookings)
    .where(eq(bookings.syncStatus, "pending_sync"));
}
```

---

## Step 4 — Update `SyncService`

**File:** `src/services/syncService.ts`

### 4.1 Fix `syncBookingUpdate` to use `monolithId`

The current implementation logs a warning because it lacks the monolith ID.
Now that we store it, use it:

```ts
async syncBookingUpdate(booking: Booking, userAccessToken: string): Promise<void> {
  if (!booking.monolithId) {
    // Booking was never synced to the monolith — skip update for now
    console.warn(`⚠️  Skipping update sync for ${booking.id} — no monolithId yet`);
    return;
  }

  const statusMap: Record<string, string> = {
    pending: "PENDING",
    confirmed: "CONFIRMED",
    completed: "COMPLETED",
    cancelled: "CANCELLED",
    declined: "CANCELLED",
  };

  const response = await fetch(`${MONOLITH_BASE_URL}/bookings/${booking.monolithId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: statusMap[booking.status] ?? "PENDING" }),
  });

  if (!response.ok) {
    throw new Error(`Monolith update failed: ${response.status}`);
  }

  console.log(`✅ Synced booking update ${booking.id} → monolith ${booking.monolithId}`);
}
```

### 4.2 Add `retrySingleBooking` method

Attempts to push one `pending_sync` booking to the monolith and updates local state.
This is used by the retry endpoint (Step 7) when the mobile app calls it:

```ts
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
      await bookingService.markSyncFailed(booking.id);
      return "failed";
    }

    const data = (await response.json()) as MonolithBookingResponse;
    await bookingService.markAsSynced(booking.id, data.data._id);
    console.log(`✅ Retry synced booking ${booking.id} → monolith ${data.data._id}`);
    return "synced";
  } catch (err) {
    console.error(`❌ Retry failed for booking ${booking.id}:`, err);
    // Do not mark as sync_failed here — transient network errors should remain
    // as pending_sync so the next retry attempt can try again
    return "failed";
  }
}
```

> **Note:** A definitive failure (e.g. 4xx from the monolith) calls `markSyncFailed`.
> A transient error (network timeout, 5xx) is left as `pending_sync` so the next
> app-triggered retry can try again.

---

## Step 5 — Update `guestBookings` Route

**File:** `src/routes/guestBookings.ts`

### 5.1 Rewrite `POST /` — Offline-First Creation

**Before:** Monolith fails → entire request fails → nothing saved locally.

**After:** Monolith fails → booking saved locally with `syncStatus: "pending_sync"` → `201` returned with a warning.

```
Flow:
  1. Generate a local UUID immediately
  2. Try to create booking in monolith
      ✅ Success → save locally with monolithId + syncStatus: "synced"
      ❌ Failure → save locally with monolithId: null + syncStatus: "pending_sync"
  3. Return 201 in both cases
     (include a `warning` field in the response when pending_sync)
```

Key change — the local `id` is now always our own UUID, never borrowed from the monolith:

```ts
// Generate local ID before even trying the monolith
const localId = crypto.randomUUID();

let monolithId: string | null = null;
let syncStatus: "synced" | "pending_sync" = "pending_sync";

try {
  const syncService = new SyncService();
  const monolithResponse = await syncService.createBookingInMonolith(
    data.propertyId, startTime, endTime, userAccessToken,
  );
  monolithId = monolithResponse.data._id;
  syncStatus = "synced";
} catch (syncError) {
  console.warn("Monolith unavailable — booking created locally as pending_sync");
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

const responsePayload = {
  success: true,
  data: newBooking,
  ...(syncStatus === "pending_sync" && {
    warning: "Booking saved locally but could not reach the main server. It will sync automatically.",
  }),
};

return c.json(responsePayload, 201);
```

### 5.2 Guard `POST /payment` on `monolithId`

Payment sync requires the monolith to already know about the booking.
Add an explicit check before proceeding:

```ts
const booking = await bookingService.getBookingById(data.bookingId);

if (!booking) {
  return c.json({ success: false, error: "Booking not found" }, 404);
}

// Guard: cannot process payment for a booking that hasn't reached the monolith yet
if (!booking.monolithId) {
  return c.json(
    {
      success: false,
      error: "This booking has not yet synced to the main server. Please try again shortly.",
      syncStatus: booking.syncStatus,
    },
    409, // Conflict — precondition not met
  );
}
```

---

## Step 6 — Update `hostBookings` Route

**File:** `src/routes/hostBookings.ts`

### No structural changes needed

The host routes call `syncService.syncBookingUpdate(booking, token)`, which after
**Step 4.1** will correctly use `booking.monolithId`. The guard inside
`syncBookingUpdate` (skip silently if `monolithId` is null) handles unsynced bookings
gracefully without any route-level changes.

---

## Step 7 — Add the Retry Endpoint

**File:** `src/routes/bookings.ts`

This is a **required** endpoint. The mobile app will call it periodically to flush
any `pending_sync` bookings — particularly after the device regains connectivity or
after a known monolith outage. It is not a fire-and-forget background job; it runs
on demand, triggered by the client.

```
POST /api/bookings/sync/retry
Authorization: Bearer <user_access_token>
```

### Why the user's own token?

`retrySingleBooking` calls `POST /bookings` on the monolith using the same user
token that was originally used when the booking was created. Since we don't store
the token, the mobile app must supply it again at retry time. This keeps the retry
semantically identical to the original creation request.

### Behaviour

- Fetches all bookings with `syncStatus: "pending_sync"`
- Attempts to push each one to the monolith
- Marks each as `"synced"` (on success) or leaves it as `"pending_sync"` (on transient failure) or `"sync_failed"` (on definitive rejection)
- Returns a summary so the client knows what happened

```ts
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
      return c.json({ success: true, message: "Nothing to sync", total: 0, synced: 0, failed: 0 });
    }

    const results = await Promise.allSettled(
      pending.map((b) => syncService.retrySingleBooking(b, userAccessToken, bookingService)),
    );

    const synced = results.filter(
      (r) => r.status === "fulfilled" && r.value === "synced"
    ).length;

    const failed = results.filter(
      (r) => r.status === "fulfilled" && r.value === "failed"
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
```

---

## Summary of State Transitions

```
                  Monolith UP
                  ┌─────────────────────────────────┐
                  │                                 │
POST /bookings ──►│ Generate UUID locally           │──► id: "<uuid>"
                  │ Create in monolith              │    monolithId: "<monolith _id>"
                  │ Save locally                    │    syncStatus: "synced"
                  └─────────────────────────────────┘

                  Monolith DOWN
                  ┌─────────────────────────────────┐
                  │                                 │
POST /bookings ──►│ Generate UUID locally           │──► id: "<uuid>"
                  │ Monolith call fails             │    monolithId: null
                  │ Save locally anyway             │    syncStatus: "pending_sync"
                  └─────────────────────────────────┘
                              │
                              │  Mobile app calls POST /sync/retry
                              │  (monolith is back up)
                              ▼
                  ┌─────────────────────────────────┐
                  │  retrySingleBooking()           │──► monolithId: "<monolith _id>"
                  │  POST /bookings to monolith     │    syncStatus: "synced"
                  └─────────────────────────────────┘
                              │
                              │  Monolith rejects (4xx)
                              ▼
                         syncStatus: "sync_failed"
                         (manual investigation needed)

                  Existing data after migration
                  ┌─────────────────────────────────┐
                  │  id = "<monolith _id>"          │──► monolithId: "<monolith _id>"
                  │  (already the monolith's id)    │    syncStatus: "synced"
                  │  Backfilled by migration UPDATE │    (never queued for retry)
                  └─────────────────────────────────┘
```

---

## Dependency Chain

```
POST /payment requires monolithId != null
         │
         └── which requires syncStatus == "synced"
                  │
                  └── which requires either:
                        a) Monolith was UP during POST /bookings, OR
                        b) POST /sync/retry ran successfully (mobile app triggered)
```

---

## Implementation Order

1. `src/db/schema.ts` — add `monolithId` + `syncStatus` columns and index
2. `migrations/` — create migration with ADD COLUMN + backfill UPDATE + CREATE INDEX
3. `src/services/bookingService.ts` — update interfaces, UUID generation, new methods
4. `src/services/syncService.ts` — fix `syncBookingUpdate` to use `monolithId`, add `retrySingleBooking`
5. `src/routes/guestBookings.ts` — offline-first booking creation + payment guard
6. `src/routes/hostBookings.ts` — verify existing sync calls still work (no changes expected)
7. `src/routes/bookings.ts` — implement `POST /sync/retry` endpoint