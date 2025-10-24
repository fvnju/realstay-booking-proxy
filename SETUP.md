# RealStay Bookings - Setup & Usage Guide

Complete guide for setting up and using the RealStay Bookings microservice.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Database Setup](#database-setup)
- [Migration from Monolith](#migration-from-monolith)
- [Development](#development)
- [Deployment](#deployment)
- [API Usage](#api-usage)
- [Troubleshooting](#troubleshooting)

---

## Overview

RealStay Bookings is a microservice that replaces the monolithic backend's booking functionality. It provides:

- **Separate Guest & Host Endpoints** - Clear separation between guest/tenant and host/owner operations
- **Real-time Monolith Sync** - Automatically syncs new bookings to the existing monolith
- **Edge Deployment** - Built on Cloudflare Workers with D1 database
- **Type Safety** - Full TypeScript with Zod validation

**Tech Stack:**
- Framework: Hono
- Database: Cloudflare D1 (SQLite)
- ORM: Drizzle
- Runtime: Cloudflare Workers
- Language: TypeScript

---

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 18+ or **Bun** runtime
- **Wrangler CLI** (Cloudflare's CLI tool)
- **Git**
- **Cloudflare Account** (for deployment)
- **Monolith API Credentials** (email & password)

---

## Initial Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd realstay-bookings

# Install dependencies
bun install
# or
npm install
```

### 2. Configure Cloudflare

```bash
# Login to Cloudflare
bun x wrangler login

# Create D1 database (already done, but for reference)
bun x wrangler d1 create realstay-bookings-db
```

The database ID should already be in `wrangler.jsonc`:
```jsonc
"database_id": "ee5375eb-6330-4e78-adad-aa73762efdcb"
```

---

## Database Setup

### Local D1 Setup

```bash
# 1. Generate migrations from schema
bun run db:generate

# 2. Apply migrations to local D1
bun run db:migrate:local

# 3. Verify tables were created
bun x wrangler d1 execute realstay-bookings-db --command="SELECT name FROM sqlite_master WHERE type='table';" --local
```

### Remote D1 Setup (Production)

```bash
# Apply migrations to remote D1
bun run db:migrate:remote
```

---

## Migration from Monolith

This is a **one-time operation** to import existing bookings from the monolith.

### Step 1: Fetch Data from Monolith

```bash
# Set your monolith credentials
export MONOLITH_EMAIL="your@email.com"
export MONOLITH_PASSWORD="yourpassword"

# Fetch bookings into local SQLite (bookings.db)
bun run migrate
```

**What this does:**
- Authenticates with monolith API
- Fetches all bookings with pagination
- Transforms data to new schema
- Stores in local SQLite file

### Step 2: Export to SQL

```bash
# Generate SQL INSERT statements
bun run export
```

This creates `bookings-export.sql` with all booking data.

### Step 3: Import to D1

**Local D1:**
```bash
bun x wrangler d1 execute realstay-bookings-db --file=bookings-export.sql --local
```

**Remote D1 (Production):**
```bash
bun x wrangler d1 execute realstay-bookings-db --file=bookings-export.sql --remote
```

### Verify Import

```bash
# Check local D1
bun x wrangler d1 execute realstay-bookings-db --command="SELECT COUNT(*) FROM bookings;" --local

# Check remote D1
bun x wrangler d1 execute realstay-bookings-db --command="SELECT COUNT(*) FROM bookings;" --remote
```

---

## Development

### Start Dev Server

```bash
bun run dev
```

The API will be available at `http://localhost:8787`

### Test Endpoints

```bash
# Health check
curl http://localhost:8787

# List bookings (requires userId)
curl "http://localhost:8787/api/guests/bookings?userId=<uuid>"
```

### Database Tools

```bash
# Open Drizzle Studio (for local SQLite)
bun run db:studio:local

# Push schema changes to local SQLite
bun run db:push:local

# List D1 migrations
bun run db:list
```

---

## Deployment

### 1. Deploy to Cloudflare Workers

```bash
# Deploy the worker
bun run deploy
```

### 2. Access Your API

Your API will be available at:
```
https://realstay-bookings.<your-subdomain>.workers.dev
```

### 3. Monitor

Visit [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → realstay-bookings

---

## API Usage

### Authentication

All requests that sync to the monolith require the user's Bearer token:

```bash
Authorization: Bearer <user_access_token>
```

### Guest Endpoints

**List Guest Bookings**
```bash
GET /api/guests/bookings?userId=<uuid>&status=pending,confirmed

Query Params:
  - userId (required): Guest's user ID
  - propertyId (optional): Filter by property
  - status (optional): Comma-separated statuses
  - startDate (optional): ISO 8601 datetime
  - endDate (optional): ISO 8601 datetime
```

**Get Specific Booking**
```bash
GET /api/guests/bookings/:id?userId=<uuid>

Query Params:
  - userId (required): For authorization check
```

**Create New Booking**
```bash
POST /api/guests/bookings
Headers:
  Authorization: Bearer <token>
  Content-Type: application/json

Body:
{
  "propertyId": "uuid",
  "userId": "uuid",
  "ownerId": "uuid",
  "startTime": "2025-11-01T10:00:00Z",
  "endTime": "2025-11-01T12:00:00Z",
  "type": "viewing",
  "notes": "Optional notes"
}

Response:
{
  "success": true,
  "data": { booking object }
}
```

**Cancel Booking**
```bash
PATCH /api/guests/bookings/:id/cancel?userId=<uuid>
Headers:
  Authorization: Bearer <token>
```

### Host Endpoints

**List Host's Property Bookings**
```bash
GET /api/hosts/bookings?ownerId=<uuid>&status=pending

Query Params:
  - ownerId (required): Property owner's ID
  - propertyId (optional): Filter by specific property
  - status (optional): Comma-separated statuses
  - startDate (optional): ISO 8601 datetime
  - endDate (optional): ISO 8601 datetime
```

**Get Specific Booking**
```bash
GET /api/hosts/bookings/:id?ownerId=<uuid>
```

**Confirm Booking**
```bash
PATCH /api/hosts/bookings/:id/confirm?ownerId=<uuid>
Headers:
  Authorization: Bearer <token>
```

**Decline Booking**
```bash
PATCH /api/hosts/bookings/:id/decline?ownerId=<uuid>
Headers:
  Authorization: Bearer <token>
```

**Complete Booking**
```bash
PATCH /api/hosts/bookings/:id/complete?ownerId=<uuid>
Headers:
  Authorization: Bearer <token>
```

### Booking Statuses

- `pending` - Awaiting host confirmation
- `confirmed` - Host confirmed
- `completed` - Booking finished
- `cancelled` - Cancelled by guest
- `declined` - Declined by host

### Booking Types

- `viewing` - Property viewing
- `inspection` - Property inspection
- `reservation` - Actual reservation

---

## Monolith Integration

### How Sync Works

1. **Creating Bookings**: When a guest creates a booking:
   - Booking is saved locally first
   - Then synced to monolith using user's token
   - Only `listing_id`, `start_date`, `end_date` are sent
   - If sync fails, booking still exists locally with warning

2. **Updating Bookings**: Status changes (confirm, decline, cancel):
   - Update happens locally first
   - Optional non-blocking sync to monolith
   - Failures are logged but don't block response

### Status Mapping

| This Service | Monolith  |
|-------------|-----------|
| pending     | PENDING   |
| confirmed   | CONFIRMED |
| completed   | COMPLETED |
| cancelled   | CANCELLED |
| declined    | CANCELLED |

---

## Troubleshooting

### "Database binding not found"

**Problem**: Worker can't find D1 database

**Solution**: Ensure `wrangler.jsonc` has correct database_id:
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "realstay-bookings-db",
    "database_id": "ee5375eb-6330-4e78-adad-aa73762efdcb"
  }
]
```

### "UNIQUE constraint failed"

**Problem**: Duplicate booking data during import

**Solution**: The schema prevents duplicate bookings (same user + time). This is intentional. Check your source data.

### "Authorization header required"

**Problem**: Trying to create booking without token

**Solution**: Include user's Bearer token:
```bash
curl -H "Authorization: Bearer <token>" ...
```

### Migration fails

**Problem**: Migration script errors

**Solution**:
```bash
# Clear and restart
rm -rf migrations/
bun run db:generate
bun run db:migrate:local
```

### Dev server won't start

**Problem**: `__filename is not defined`

**Solution**: This should be fixed. The issue was `better-sqlite3` being loaded in Workers. Now it's isolated to `src/db/local.ts`.

---

## Project Structure

```
realstay-bookings/
├── src/
│   ├── db/
│   │   ├── index.ts           # D1 database connection (Workers)
│   │   ├── local.ts           # Local SQLite (migrations only)
│   │   └── schema.ts          # Database schema
│   ├── routes/
│   │   ├── bookings.ts        # Legacy routes
│   │   ├── guestBookings.ts   # Guest endpoints
│   │   └── hostBookings.ts    # Host endpoints
│   ├── services/
│   │   ├── bookingService.ts  # Business logic
│   │   ├── monolithClient.ts  # Monolith API client
│   │   └── syncService.ts     # Sync logic
│   ├── env/
│   │   └── index.ts           # TypeScript env types
│   └── index.ts               # Main app entry
├── scripts/
│   ├── migrate-bookings.ts    # Fetch from monolith
│   ├── export-to-sql.ts       # Export to SQL
│   └── init-local-db.ts       # Init local SQLite
├── migrations/                # Generated SQL migrations
├── wrangler.jsonc            # Cloudflare config
├── drizzle.config.ts         # Drizzle config (D1)
├── drizzle.config.local.ts   # Drizzle config (SQLite)
└── package.json
```

---

## Available Scripts

```bash
# Development
bun run dev                    # Start dev server

# Database - D1
bun run db:generate            # Generate migrations from schema
bun run db:migrate:local       # Apply to local D1
bun run db:migrate:remote      # Apply to remote D1
bun run db:list                # List migration status

# Database - Local SQLite (for testing)
bun run db:push:local          # Push schema to SQLite
bun run db:studio:local        # Open Drizzle Studio

# Migration from Monolith
bun run init-db                # Create local SQLite tables
bun run migrate                # Fetch from monolith
bun run export                 # Export to SQL

# Deployment
bun run deploy                 # Deploy to Cloudflare
bun run cf-typegen             # Generate CF types
```

---

## Support

For issues or questions:

1. Check this documentation
2. Review error logs in Cloudflare Dashboard
3. Check monolith API is accessible
4. Verify database migrations are applied

---

## License

MIT
