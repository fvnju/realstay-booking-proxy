/**
 * Client for interacting with the RealStay monolith API
 */

export const MONOLITH_BASE_URL = "https://realstay-api-staging.edgetechino.com";

export interface MonolithBooking {
  _id: string;
  customer_id: string;
  property_owner_id: string;
  listing_id: string;
  start_date: string;
  end_date: string;
  status: "PENDING" | "RESERVED" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
  createdAt: string;
  updatedAt: string;
  __v: number;
  owner?: {
    _id: string;
    email: string;
    first_name: string;
    last_name: string;
    phone_number: string;
    image_url: string | null;
    gender: string;
    user_type: string;
    status: string;
  };
  customer?: {
    _id: string;
    email: string;
    first_name: string;
    last_name: string;
    phone_number: string;
    image_url: string | null;
    gender: string;
    user_type: string;
    status: string;
  };
}

export interface MonolithBookingsResponse {
  data: {
    bookings: MonolithBooking[];
  };
  success: boolean;
  pagination: {
    total_items: number;
    total_pages: number;
    current_page: number;
    limit: number;
  };
}

export interface MonolithAuthResponse {
  data: {
    user: {
      id: string;
      email: string;
    };
    access_token: string;
    refresh_token: string;
  };
  success: boolean;
}

export type PaymentForBookingResponse = {
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
    paymentRef: string;
  };
  success: boolean;
};

export class MonolithClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(
    private email?: string,
    private password?: string,
  ) {}

  /**
   * Authenticate with the monolith API
   */
  async authenticate(): Promise<void> {
    if (!this.email || !this.password) {
      throw new Error(
        "Email and password are required for monolith authentication",
      );
    }

    const response = await fetch(`${MONOLITH_BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: this.email,
        password: this.password,
      }),
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.statusText}`);
    }

    const data = (await response.json()) as MonolithAuthResponse;
    this.accessToken = data.data.access_token;
    this.refreshToken = data.data.refresh_token;
  }

  /**
   * Ensure we have a valid access token
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken) {
      await this.authenticate();
    }
  }

  /**
   * Fetch bookings from the monolith with pagination
   */
  async fetchBookings(
    page: number = 1,
    pageSize: number = 100,
  ): Promise<MonolithBookingsResponse> {
    await this.ensureAuthenticated();

    const url = `${MONOLITH_BASE_URL}/bookings?page=${page}&page_size=${pageSize}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch bookings: ${response.statusText}`);
    }

    return response.json() as Promise<MonolithBookingsResponse>;
  }

  /**
   * Fetch all bookings from the monolith (handles pagination automatically)
   */
  async fetchAllBookings(): Promise<MonolithBooking[]> {
    const allBookings: MonolithBooking[] = [];
    let currentPage = 1;
    let totalPages = 1;

    do {
      const response = await this.fetchBookings(currentPage, 100);
      console.log(response);
      allBookings.push(...response.data.bookings);
      totalPages = response.pagination.total_pages;
      currentPage++;

      console.log(
        `Fetched page ${currentPage - 1}/${totalPages} (${allBookings.length} bookings so far)`,
      );
    } while (currentPage <= totalPages);

    return allBookings;
  }

  /**
   * Create a new booking in the monolith
   */
  async createBooking(bookingData: {
    listing_id: string;
    start_date: string;
    end_date: string;
  }): Promise<MonolithBooking> {
    await this.ensureAuthenticated();

    const response = await fetch(`${MONOLITH_BASE_URL}/bookings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        listing_id: bookingData.listing_id,
        start_date: bookingData.start_date,
        end_date: bookingData.end_date,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create booking in monolith: ${errorText}`);
    }

    const data = (await response.json()) as { data: MonolithBooking };
    return data.data;
  }

  /**
   * Set payment data for bookings
   */
  async setPayment(
    paymentData: { transactionRef: string; bookingId: string },
    userAccessToken: string,
  ) {
    await this.ensureAuthenticated();

    const response = await fetch(`${MONOLITH_BASE_URL}/bookings/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to set payment in monolith: ${errorText}`);
    }

    const data = (await response.json()) as PaymentForBookingResponse;
    return data.data;
  }
}
