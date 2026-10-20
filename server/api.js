import url from "node:url";
import { signJwt, verifyJwt, verifyPassword } from "./auth.js";
import {
  getUserById,
  getUserByPrn,
  getUserByEmail,
  createUser,
  updateUserPassword,
  listUsers,
  getVenues,
  getVenueById,
  createVenue,
  updateVenue,
  getBookings,
  getBookingById,
  createBooking,
  approveBooking,
  rejectBooking,
  cancelBooking,
  getStats,
  getAuditLogs,
  getNotifications,
  markNotificationsRead
} from "./db.js";

function sendJson(res, statusCode, data) {
  if (res.writableEnded) return true;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
  return true;
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, ...safe } = u;
  return safe;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Request payload too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function authenticate(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7).trim();
  const payload = verifyJwt(token);
  if (!payload || !payload.userId) return null;
  const user = getUserById(payload.userId);
  if (!user || user.account_status !== "active") return null;
  return user;
}

/**
 * Main API request handler
 */
export async function handleApiRequest(req, res) {
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams.entries());
  const method = req.method.toUpperCase();

  // CORS headers for development/testing flexibility
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // Only handle /api paths
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  try {
    // -------------------------------------------------------------
    // AUTHENTICATION ENDPOINTS
    // -------------------------------------------------------------

    // 1. Student Login (Authenticates by registered PRN)
    if (pathname === "/api/auth/student-login" && method === "POST") {
      const body = await parseBody(req);
      const prn = (body.prn || "").trim();
      const password = body.password || "";

      if (!prn || !password) {
        return sendJson(res, 400, { error: "Please enter your student PRN and password" });
      }

      const user = getUserByPrn(prn);
      if (!user) {
        return sendJson(res, 401, {
          error: `PRN "${prn}" is not registered in the student roster. Only pre-enrolled students can access the system.`
        });
      }

      if (user.role !== "student") {
        return sendJson(res, 403, { error: "This login portal is strictly reserved for MITAOE students." });
      }

      if (user.account_status !== "active") {
        return sendJson(res, 403, { error: "Your student account is currently disabled or pending verification. Contact campus admin." });
      }

      const valid = verifyPassword(password, user.password_hash);
      if (!valid) {
        return sendJson(res, 401, { error: "Invalid PRN or password. Please verify your credentials." });
      }

      const token = signJwt({ userId: user.id, role: user.role, prn: user.prn });
      return sendJson(res, 200, {
        token,
        user: sanitizeUser(user),
        message: "Student signed in successfully"
      });
    }

    // 2. Teacher Login (Authenticates by assigned verified college email)
    if (pathname === "/api/auth/teacher-login" && method === "POST") {
      const body = await parseBody(req);
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";

      if (!email || !password) {
        return sendJson(res, 400, { error: "Please enter your college email address and password" });
      }

      const user = getUserByEmail(email);
      if (!user) {
        return sendJson(res, 401, {
          error: `Email "${email}" is not authorized. Only pre-authorized college teachers and faculty can access this portal.`
        });
      }

      if (user.role !== "teacher") {
        return sendJson(res, 403, { error: "This login portal is strictly for authorized teachers and faculty members." });
      }

      if (user.account_status !== "active") {
        return sendJson(res, 403, { error: "Your teacher account is inactive or disabled. Contact administration." });
      }

      if (!user.email_verified) {
        return sendJson(res, 403, { error: "Your college email has not been verified yet. Check your inbox for activation." });
      }

      const valid = verifyPassword(password, user.password_hash);
      if (!valid) {
        return sendJson(res, 401, { error: "Invalid email or password. Please check your credentials." });
      }

      const token = signJwt({ userId: user.id, role: user.role, email: user.email });
      return sendJson(res, 200, {
        token,
        user: sanitizeUser(user),
        message: "Teacher signed in successfully"
      });
    }

    // 3. Admin Login (Dedicated administrator entry point)
    if (pathname === "/api/auth/admin-login" && method === "POST") {
      const body = await parseBody(req);
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";

      if (!email || !password) {
        return sendJson(res, 400, { error: "Please enter your administrator email and password" });
      }

      const user = getUserByEmail(email);
      if (!user || user.role !== "admin") {
        return sendJson(res, 401, {
          error: "Administrator authorization failed. Invalid credentials or account lacks administrator privileges."
        });
      }

      if (user.account_status !== "active") {
        return sendJson(res, 403, { error: "Administrator account is inactive." });
      }

      const valid = verifyPassword(password, user.password_hash);
      if (!valid) {
        return sendJson(res, 401, { error: "Invalid administrator credentials." });
      }

      const token = signJwt({ userId: user.id, role: user.role, email: user.email });
      return sendJson(res, 200, {
        token,
        user: sanitizeUser(user),
        message: "Administrator authenticated successfully"
      });
    }

    // 4. Current User Session Check
    if (pathname === "/api/auth/me" && method === "GET") {
      const user = authenticate(req);
      if (!user) {
        return sendJson(res, 401, { error: "Unauthenticated or session expired" });
      }
      return sendJson(res, 200, { user: sanitizeUser(user) });
    }

    // 5. Password Recovery
    if (pathname === "/api/auth/recover-password" && method === "POST") {
      const body = await parseBody(req);
      const identifier = (body.identifier || "").trim();

      if (!identifier) {
        return sendJson(res, 400, { error: "Please provide your PRN or registered college email address" });
      }

      // Look up account silently (never reveal if account exists or not to prevent user enumeration)
      const isStudent = getUserByPrn(identifier);
      const isTeacherOrAdmin = getUserByEmail(identifier);

      return sendJson(res, 200, {
        success: true,
        message: "If an authorized account matches this identifier, password recovery instructions have been forwarded to the registered campus contact."
      });
    }

    // 6. Change Password (Authenticated)
    if (pathname === "/api/auth/change-password" && method === "POST") {
      const user = authenticate(req);
      if (!user) return sendJson(res, 401, { error: "Authentication required" });

      const body = await parseBody(req);
      const { currentPassword, newPassword } = body;

      if (!currentPassword || !newPassword) {
        return sendJson(res, 400, { error: "Both current and new password are required" });
      }

      if (newPassword.length < 6) {
        return sendJson(res, 400, { error: "New password must be at least 6 characters long" });
      }

      const fullUser = getUserById(user.id);
      const valid = verifyPassword(currentPassword, fullUser.password_hash);
      if (!valid) {
        return sendJson(res, 401, { error: "Current password does not match" });
      }

      updateUserPassword(user.id, newPassword);
      return sendJson(res, 200, { success: true, message: "Password updated successfully" });
    }

    // -------------------------------------------------------------
    // VENUE ENDPOINTS
    // -------------------------------------------------------------

    // Get Venues
    if (pathname === "/api/venues" && method === "GET") {
      const user = authenticate(req);
      const includeInactive = user?.role === "admin" && query.includeInactive === "true";
      const venues = getVenues({ includeInactive });
      return sendJson(res, 200, { venues });
    }

    // Create Venue (Admin Only)
    if (pathname === "/api/venues" && method === "POST") {
      const user = authenticate(req);
      if (!user || user.role !== "admin") {
        return sendJson(res, 403, { error: "Only administrators can create campus venues" });
      }

      const body = await parseBody(req);
      const { name, category, location, capacity, facilities, description, color, is_active } = body;

      if (!name || !category || !location || !capacity) {
        return sendJson(res, 400, { error: "Name, category, location, and capacity are required" });
      }

      try {
        const venue = createVenue({
          name, category, location, capacity, facilities, description, color, is_active: is_active ?? 1
        });
        return sendJson(res, 201, { venue, message: "Venue created successfully" });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // Update Venue (Admin Only)
    const venueIdMatch = pathname.match(/^\/api\/venues\/([^/]+)$/);
    if (venueIdMatch && method === "PUT") {
      const venueId = venueIdMatch[1];
      const user = authenticate(req);
      if (!user || user.role !== "admin") {
        return sendJson(res, 403, { error: "Only administrators can modify venues" });
      }

      const body = await parseBody(req);
      try {
        const updated = updateVenue(venueId, body);
        return sendJson(res, 200, { venue: updated, message: "Venue updated successfully" });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // BOOKING ENDPOINTS
    // -------------------------------------------------------------

    // Get Bookings (Isolated by role: normal users only see their own)
    if (pathname === "/api/bookings" && method === "GET") {
      const user = authenticate(req);
      if (!user) {
        return sendJson(res, 401, { error: "Authentication required to view bookings" });
      }

      const bookings = getBookings({
        userId: user.id,
        role: user.role,
        status: query.status,
        venue_id: query.venue_id,
        date_from: query.date_from,
        date_to: query.date_to,
        search: query.search
      });

      return sendJson(res, 200, { bookings });
    }

    // Create New Booking (Authenticated: Student, Teacher, or Admin)
    if (pathname === "/api/bookings" && method === "POST") {
      const user = authenticate(req);
      if (!user) {
        return sendJson(res, 401, { error: "Please sign in to submit a venue booking request" });
      }

      const body = await parseBody(req);
      const { venue_id, event_name, event_type, event_date, start_time, end_time, attendee_count, purpose } = body;

      if (!venue_id || !event_name || !event_date || !start_time || !end_time || !attendee_count || !purpose) {
        return sendJson(res, 400, { error: "Please fill in all required booking fields" });
      }

      try {
        const booking = createBooking({
          requester_id: user.id,
          venue_id,
          event_name,
          event_type: event_type || "Academic",
          event_date,
          start_time,
          end_time,
          attendee_count,
          purpose
        });

        return sendJson(res, 201, {
          booking,
          message: "Booking request submitted successfully. It is pending administrator review and approval."
        });
      } catch (err) {
        const statusCode = err.code === "CONFLICT" ? 409 : 400;
        return sendJson(res, statusCode, { error: err.message });
      }
    }

    // Update Booking Status (ADMIN ONLY: Approve or Reject)
    const bookingStatusMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/status$/);
    if (bookingStatusMatch && method === "PUT") {
      const bookingId = bookingStatusMatch[1];
      const user = authenticate(req);
      if (!user || user.role !== "admin") {
        return sendJson(res, 403, { error: "Unauthorized: Administrator privileges required to approve or reject bookings" });
      }

      const body = await parseBody(req);
      const { status, reason } = body;

      if (!status || !["approved", "rejected"].includes(status)) {
        return sendJson(res, 400, { error: "Status must be either 'approved' or 'rejected'" });
      }

      const ipAddress = req.socket.remoteAddress || "127.0.0.1";

      try {
        let updated;
        if (status === "approved") {
          updated = approveBooking({ bookingId, adminId: user.id, ipAddress });
        } else {
          updated = rejectBooking({ bookingId, adminId: user.id, reason, ipAddress });
        }

        return sendJson(res, 200, {
          booking: updated,
          message: `Booking request ${status} successfully`
        });
      } catch (err) {
        const statusCode = err.code === "CONFLICT" ? 409 : 400;
        return sendJson(res, statusCode, { error: err.message });
      }
    }

    // Cancel Booking (Requester cancels their own pending booking)
    const bookingCancelMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/cancel$/);
    if (bookingCancelMatch && method === "PUT") {
      const bookingId = bookingCancelMatch[1];
      const user = authenticate(req);
      if (!user) return sendJson(res, 401, { error: "Authentication required" });

      try {
        const updated = cancelBooking({ bookingId, userId: user.id });
        return sendJson(res, 200, { booking: updated, message: "Booking cancelled successfully" });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // ADMIN DASHBOARD, USERS & AUDIT LOGS
    // -------------------------------------------------------------

    // Admin Dashboard Statistics
    if (pathname === "/api/admin/stats" && method === "GET") {
      const user = authenticate(req);
      if (!user || user.role !== "admin") {
        return sendJson(res, 403, { error: "Administrator authorization required" });
      }
      const stats = getStats();
      return sendJson(res, 200, { stats });
    }

    // Admin Audit Logs
    if (pathname === "/api/admin/audit-logs" && method === "GET") {
      const user = authenticate(req);
      if (!user || user.role !== "admin") {
        return sendJson(res, 403, { error: "Administrator authorization required" });
      }
      const logs = getAuditLogs({ limit: Number(query.limit) || 50 });
      return sendJson(res, 200, { logs });
    }

    // Admin User Directory
    if (pathname === "/api/admin/users" && method === "GET") {
      const user = authenticate(req);
      if (!user || user.role !== "admin") {
        return sendJson(res, 403, { error: "Administrator authorization required" });
      }
      const users = listUsers({ role: query.role, search: query.search });
      return sendJson(res, 200, { users });
    }

    // Admin User Provisioning
    if (pathname === "/api/admin/users" && method === "POST") {
      const user = authenticate(req);
      if (!user || user.role !== "admin") {
        return sendJson(res, 403, { error: "Administrator authorization required to provision accounts" });
      }

      const body = await parseBody(req);
      const { prn, email, password, full_name, role, department } = body;

      if (!full_name || !password || !role) {
        return sendJson(res, 400, { error: "Full name, role, and initial password are required" });
      }

      try {
        const created = createUser({
          prn,
          email,
          password,
          full_name,
          role,
          department,
          account_status: "active",
          email_verified: 1
        });
        return sendJson(res, 201, { user: created, message: `Account provisioned successfully for ${full_name}` });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // NOTIFICATIONS
    // -------------------------------------------------------------

    if (pathname === "/api/notifications" && method === "GET") {
      const user = authenticate(req);
      if (!user) return sendJson(res, 401, { error: "Authentication required" });
      const notifications = getNotifications(user.id);
      return sendJson(res, 200, { notifications });
    }

    if (pathname === "/api/notifications/mark-read" && method === "POST") {
      const user = authenticate(req);
      if (!user) return sendJson(res, 401, { error: "Authentication required" });
      markNotificationsRead(user.id);
      return sendJson(res, 200, { success: true });
    }

    // Unknown API route
    return sendJson(res, 404, { error: `Endpoint ${pathname} not found` });
  } catch (err) {
    console.error("API Error:", err);
    return sendJson(res, 500, { error: "Internal server error occurred", message: err.message });
  }
}
