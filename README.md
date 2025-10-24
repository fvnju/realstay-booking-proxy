# RealStay Bookings Microservice

A clean, modern booking management API service built to replace the monolithic backend's booking functionality. Built with Hono, Drizzle ORM, and Cloudflare Workers for edge deployment.

## Features

- **Separate Guest and Host Endpoints**: Clear separation of concerns between guest/tenant bookings and host/owner bookings
- **Real-time Sync**: Automatically syncs new bookings to the monolith backend
- **Type-safe**: Full TypeScript support with Zod validation
- **Edge Deployment**: Built for Cloudflare Workers with D1 database
- **Migration Tools**: One-time migration script to import existing bookings from monolith
- **Advanced Filtering**: Filter bookings by property, status, date range, and more
- **Availability Management**: Built-in conflict detection and availability checking
- **Booking Settings**: Configurable advance notice, duration limits, and booking windows per property

## Quick Start

### Installation

```bash
npm install
```

### Environment Setup

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Fill in your monolith API credentials in `.env`:
```env
MONOLITH_EMAIL=your-email@example.com
MONOLITH_PASSWORD=your-password
```

### Database Setup

Push the schema to your database:
```bash
npm run db:push
```

### Migration

Import existing bookings from the monolith (one-time operation):
```bash
MONOLITH_EMAIL=your@email.com MONOLITH_PASSWORD=yourpassword npm run migrate
```

### Development

Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:8787`

## API Endpoints

### Guest Endpoints

Guests/tenants use these endpoints to manage their bookings.

#### List Guest Bookings
```http
GET /api/guests/bookings?userId=<string>
```

**Query Parameters:**
- `userId` (required) - Guest user ID
- `propertyId` (optional) - Filter by specific property
- `status` (optional) - Comma-separated list of statuses (e.g., `"pending,confirmed"`)
- `startDate` (optional) - Filter bookings starting from this date (ISO 8601)
- `endDate` (optional) - Filter bookings ending before this date (ISO 8601)

**Example:**
```bash
GET /api/guests/bookings?userId=user-123&status=confirmed,pending&startDate=2025-10-01T00:00:00Z
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "booking-uuid",
      "propertyId": "property-uuid",
      "userId": "user-uuid",
      "ownerId": "owner-uuid",
      "startTime": "2025-10-20T10:00:00Z",
      "endTime": "2025-10-20T11:00:00Z",
      "status": "confirmed",
      "type": "viewing",
      "notes": "Looking forward to viewing the property",
      "paymentStatus": "paid",
      "createdAt": "2025-10-13T08:00:00Z",
      "updatedAt": "2025-10-13T08:00:00Z"
    }
  ]
}
```

#### Get Specific Booking
```http
GET /api/guests/bookings/:id?userId=<string>
```

**Query Parameters:**
- `userId` (required) - Guest user ID for authorization

#### Create New Booking
```http
POST /api/guests/bookings
Authorization: Bearer <user-access-token>
```

**Request Body:**
```json
{
  "propertyId": "property-uuid",
  "userId": "user-uuid",
  "ownerId": "owner-uuid",
  "startTime": "2025-10-20T10:00:00Z",
  "endTime": "2025-10-20T11:00:00Z",
  "type": "viewing",
  "notes": "Optional notes"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "new-booking-uuid",
    "status": "pending",
    ...
  }
}
```

#### Cancel Booking
```http
PATCH /api/guests/bookings/:id/cancel?userId=<string>
Authorization: Bearer <user-access-token>
```

---

### Host Endpoints

Hosts/property owners use these endpoints to manage bookings on their properties.

#### List Host's Property Bookings
```http
GET /api/hosts/bookings?ownerId=<string>
```

**Query Parameters:**
- `ownerId` (required) - Property owner ID
- `propertyId` (optional) - Filter by specific property
- `status` (optional) - Comma-separated list of statuses
- `startDate` (optional) - Filter bookings starting from this date (ISO 8601)
- `endDate` (optional) - Filter bookings ending before this date (ISO 8601)

**Example:**
```bash
GET /api/hosts/bookings?ownerId=owner-123&propertyId=prop-456&status=pending
```

#### Get Specific Booking
```http
GET /api/hosts/bookings/:id?ownerId=<string>
```

#### Confirm Booking
```http
PATCH /api/hosts/bookings/:id/confirm?ownerId=<string>
Authorization: Bearer <user-access-token>
```

#### Decline Booking
```http
PATCH /api/hosts/bookings/:id/decline?ownerId=<string>
Authorization: Bearer <user-access-token>
```

#### Complete Booking
```http
PATCH /api/hosts/bookings/:id/complete?ownerId=<string>
Authorization: Bearer <user-access-token>
```

---

### Legacy Endpoints

For backward compatibility, the original endpoints are still available:
- `GET /api/bookings` - List all bookings (with filters)
- `GET /api/bookings/:id` - Get specific booking
- `POST /api/bookings` - Create new booking
- `PUT /api/bookings/:id` - Update booking
- `DELETE /api/bookings/:id` - Delete booking
- `PATCH /api/bookings/:id/confirm` - Confirm booking
- `PATCH /api/bookings/:id/cancel` - Cancel booking
- `PATCH /api/bookings/:id/complete` - Mark as completed

## Data Schema

### Booking
```typescript
{
  id: string;           // UUID
  propertyId: string;   // Property/listing ID
  userId: string;       // Customer/guest ID
  ownerId: string;      // Property owner ID
  startTime: Date;      // Booking start time
  endTime: Date;        // Booking end time
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'declined';
  type: 'viewing' | 'inspection' | 'reservation';
  createdAt: Date;      // Created timestamp
  updatedAt: Date;      // Last updated timestamp
  cancelledAt?: Date;   // Cancellation timestamp (if applicable)
  notes?: string;       // Additional notes
  paymentStatus: 'pending' | 'paid' | 'refunded' | 'failed';
}
```

### Booking Availability
```typescript
{
  id: string;
  propertyId: string;
  availableStartTime: Date;
  availableEndTime: Date;
  isAvailable: boolean;  // false = blocked time slot
  dayOfWeek?: number;    // 0-6 (Sunday-Saturday)
  createdAt: Date;
  updatedAt: Date;
}
```

### Booking Settings
```typescript
{
  id: string;
  propertyId: string;
  minAdvanceNoticeHours: number;   // Minimum hours before booking
  maxAdvanceBookingDays: number;   // Maximum days in advance
  maxDurationHours: number;        // Maximum booking duration
  bookingWindowStart: string;      // e.g., "09:00"
  bookingWindowEnd: string;        // e.g., "18:00"
  bufferTimeBetweenBookings: number; // Minutes between bookings
  createdAt: Date;
  updatedAt: Date;
}
```

### Status Values
- **pending**: Booking request submitted, awaiting host confirmation
- **confirmed**: Host has confirmed the booking
- **completed**: Booking has been completed successfully
- **cancelled**: Guest cancelled the booking
- **declined**: Host declined the booking

### Booking Types
- **viewing**: Property viewing appointment
- **inspection**: Property inspection appointment
- **reservation**: Full property reservation/rental

## Monolith Integration

### How Sync Works

The service maintains data consistency with the existing monolith backend:

1. **New Bookings**: When a booking is created via `POST /api/guests/bookings`:
   - Booking is saved to the local database first (fast response)
   - System attempts to sync to monolith synchronously using the user's access token
   - If sync fails, the booking still exists locally with a warning returned
   - The monolith sync uses the user's Authorization token for proper attribution

2. **Booking Updates**: When bookings are modified (confirm, cancel, complete):
   - Updates are saved locally immediately
   - Sync to monolith happens asynchronously (non-blocking)
   - Failures are logged but don't block the response

3. **Authorization**:
   - Guest endpoints require a valid `Authorization: Bearer <token>` header for create/update operations
   - The token is passed through to the monolith for proper user authentication
   - Query operations only require the userId/ownerId in query parameters

### Status Mapping

The service automatically maps statuses between the new microservice and monolith formats:

| Microservice Status | Monolith Status |
|---------------------|-----------------|
| pending             | PENDING         |
| confirmed           | CONFIRMED       |
| completed           | COMPLETED       |
| cancelled           | CANCELLED       |
| declined            | CANCELLED       |

### Monolith API Configuration

Set these environment variables for monolith integration:

```env
MONOLITH_EMAIL=your-service-account@example.com
MONOLITH_PASSWORD=your-service-password
```

These credentials are used to obtain an admin token for system-level operations.

## Deployment

### Cloudflare Workers

1. Set your secrets:
```bash
wrangler secret put MONOLITH_EMAIL
wrangler secret put MONOLITH_PASSWORD
```

2. Deploy:
```bash
npm run deploy
```

### Database

The service uses Cloudflare D1 in production and SQLite locally.

Configure your D1 database ID in `wrangler.jsonc`:
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "realstay-bookings-db",
    "database_id": "your-database-id"
  }
]
```

## Project Structure

```
├── src/
│   ├── db/
│   │   ├── schema.ts          # Database schema
│   │   └── index.ts           # Database connection
│   ├── routes/
│   │   ├── bookings.ts        # Legacy routes
│   │   ├── guestBookings.ts   # Guest-specific routes
│   │   └── hostBookings.ts    # Host-specific routes
│   ├── services/
│   │   ├── bookingService.ts  # Business logic
│   │   ├── monolithClient.ts  # Monolith API client
│   │   └── syncService.ts     # Sync logic
│   ├── env/
│   │   └── index.ts           # Environment types
│   └── index.ts               # Main app
├── scripts/
│   └── migrate-bookings.ts    # Migration script
└── wrangler.jsonc             # Cloudflare config
```

## Development Scripts

- `npm run dev` - Start development server
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run migrate` - Run migration from monolith
- `npm run db:push` - Push schema to database
- `npm run db:studio` - Open Drizzle Studio
- `npm run cf-typegen` - Generate Cloudflare types

## Architecture Notes

### Why Separate Guest/Host Endpoints?

The API is intentionally split into guest and host-specific routes rather than using a single unified endpoint:

1. **Better Authorization**: Each endpoint can enforce role-specific access control
   - Guests can only view/cancel their own bookings
   - Hosts can only manage bookings for their properties

2. **Clearer Intent**: API consumers know exactly which endpoints to use
   - Frontend can easily separate guest vs host features
   - No confusion about which operations are allowed

3. **Reduced Complexity**: No conditional logic based on user role
   - Simpler code paths
   - Easier to test and maintain

4. **Future Scalability**: Easy to add role-specific features
   - Guests might get ratings, reviews, booking history
   - Hosts might get analytics, bulk operations, calendar management

### Sync Strategy

The service uses **optimistic writes** with strategic sync patterns:

**For New Bookings** (Synchronous sync):
- Local write happens first (ensuring data persistence)
- Monolith sync happens synchronously (blocking the response)
- User gets immediate feedback if sync fails
- Uses the user's access token for proper attribution

**For Updates** (Asynchronous sync):
- Local updates happen immediately
- Monolith sync happens in the background (non-blocking)
- Failures are logged but don't block the API response
- Eventual consistency is acceptable for status changes

This hybrid approach ensures:
- **Fast response times** for most operations
- **Data integrity** for critical operations (new bookings)
- **Resilience** to temporary monolith downtime
- **User transparency** when sync issues occur

### Availability & Conflict Detection

The service includes built-in availability management:

1. **Conflict Detection**: Prevents double-booking by checking for overlapping confirmed bookings
2. **Availability Slots**: Supports blocking specific time ranges per property
3. **Booking Constraints**: Validates against property-specific settings:
   - Minimum advance notice
   - Maximum advance booking window
   - Maximum booking duration
   - Daily booking windows (e.g., 9 AM - 6 PM only)
   - Buffer time between bookings

### Error Handling

The API uses consistent error responses:

```json
{
  "success": false,
  "error": "Error message description"
}
```

Common error scenarios:
- **400 Bad Request**: Invalid input data, validation errors
- **401 Unauthorized**: Missing or invalid authorization token
- **403 Forbidden**: User doesn't have access to the resource
- **404 Not Found**: Booking or resource doesn't exist
- **500 Internal Server Error**: Server-side errors

## Common Use Cases

### As a Guest User

**1. View all my bookings**
```bash
curl "http://localhost:8787/api/guests/bookings?userId=user-123"
```

**2. View only confirmed upcoming bookings**
```bash
curl "http://localhost:8787/api/guests/bookings?userId=user-123&status=confirmed&startDate=2025-10-13T00:00:00Z"
```

**3. Create a new viewing appointment**
```bash
curl -X POST "http://localhost:8787/api/guests/bookings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "propertyId": "prop-456",
    "userId": "user-123",
    "ownerId": "owner-789",
    "startTime": "2025-10-20T14:00:00Z",
    "endTime": "2025-10-20T15:00:00Z",
    "type": "viewing",
    "notes": "Interested in the 2BR unit"
  }'
```

**4. Cancel a booking**
```bash
curl -X PATCH "http://localhost:8787/api/guests/bookings/booking-id/cancel?userId=user-123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### As a Host/Owner

**1. View all bookings for my properties**
```bash
curl "http://localhost:8787/api/hosts/bookings?ownerId=owner-789"
```

**2. View pending bookings requiring action**
```bash
curl "http://localhost:8787/api/hosts/bookings?ownerId=owner-789&status=pending"
```

**3. Confirm a booking request**
```bash
curl -X PATCH "http://localhost:8787/api/hosts/bookings/booking-id/confirm?ownerId=owner-789" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**4. View bookings for a specific property**
```bash
curl "http://localhost:8787/api/hosts/bookings?ownerId=owner-789&propertyId=prop-456"
```

## Testing

### Manual Testing

Start the development server:
```bash
npm run dev
```

Test with curl or your favorite HTTP client. All endpoints are available at `http://localhost:8787`.

### Database Inspection

View and edit data using Drizzle Studio:
```bash
npm run db:studio
```

This opens a visual database browser at `http://localhost:4983`.

## License

MIT
