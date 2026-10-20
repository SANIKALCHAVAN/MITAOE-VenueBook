const TOKEN_KEY = "mitaoe_venuebook_token";

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request(endpoint, options = {}) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  let data;
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = { error: await response.text() };
  }

  if (response.status === 401) {
    setStoredToken(null);
  }

  if (!response.ok) {
    const error = new Error(data.error || data.message || "Request failed");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  // Auth
  async loginStudent(prn, password) {
    const data = await request("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify({ prn, password })
    });
    setStoredToken(data.token);
    return data;
  },

  async loginTeacher(email, password) {
    const data = await request("/api/auth/teacher-login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setStoredToken(data.token);
    return data;
  },

  async loginAdmin(email, password) {
    const data = await request("/api/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setStoredToken(data.token);
    return data;
  },

  async getMe() {
    return request("/api/auth/me");
  },

  logout() {
    setStoredToken(null);
  },

  async recoverPassword(identifier) {
    return request("/api/auth/recover-password", {
      method: "POST",
      body: JSON.stringify({ identifier })
    });
  },

  async changePassword(currentPassword, newPassword) {
    return request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  // Venues
  async getVenues(includeInactive = false) {
    const query = includeInactive ? "?includeInactive=true" : "";
    return request(`/api/venues${query}`);
  },

  async createVenue(venueData) {
    return request("/api/venues", {
      method: "POST",
      body: JSON.stringify(venueData)
    });
  },

  async updateVenue(id, venueData) {
    return request(`/api/venues/${id}`, {
      method: "PUT",
      body: JSON.stringify(venueData)
    });
  },

  // Bookings
  async getBookings(params = {}) {
    const searchParams = new URLSearchParams();
    if (params.status && params.status !== "all") searchParams.set("status", params.status);
    if (params.venue_id && params.venue_id !== "all") searchParams.set("venue_id", params.venue_id);
    if (params.date_from) searchParams.set("date_from", params.date_from);
    if (params.date_to) searchParams.set("date_to", params.date_to);
    if (params.search) searchParams.set("search", params.search);

    const qs = searchParams.toString();
    return request(`/api/bookings${qs ? `?${qs}` : ""}`);
  },

  async createBooking(bookingData) {
    return request("/api/bookings", {
      method: "POST",
      body: JSON.stringify(bookingData)
    });
  },

  async updateBookingStatus(bookingId, status, reason = "") {
    return request(`/api/bookings/${bookingId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status, reason })
    });
  },

  async cancelBooking(bookingId) {
    return request(`/api/bookings/${bookingId}/cancel`, {
      method: "PUT"
    });
  },

  // Admin Dashboard & Operations
  async getAdminStats() {
    return request("/api/admin/stats");
  },

  async getAuditLogs(limit = 50) {
    return request(`/api/admin/audit-logs?limit=${limit}`);
  },

  async getUsers(params = {}) {
    const searchParams = new URLSearchParams();
    if (params.role) searchParams.set("role", params.role);
    if (params.search) searchParams.set("search", params.search);
    const qs = searchParams.toString();
    return request(`/api/admin/users${qs ? `?${qs}` : ""}`);
  },

  async provisionUser(userData) {
    return request("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(userData)
    });
  },

  // Notifications
  async getNotifications() {
    return request("/api/notifications");
  },

  async markNotificationsRead() {
    return request("/api/notifications/mark-read", {
      method: "POST"
    });
  },

  async getSystemStatus() {
    return request("/api/system/status");
  }
};
