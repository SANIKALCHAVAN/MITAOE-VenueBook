import express from "express";
import dotenv from "dotenv";
dotenv.config({ override: true });

import {
  isSupabaseConfigured,
  isSupabaseOnline,
  checkSupabaseSchema,
  verifySupabaseToken,
  loginStudentSupabase,
  loginTeacherSupabase,
  loginAdminSupabase,
  getVenuesSupabase,
  createVenueSupabase,
  updateVenueSupabase,
  getBookingsSupabase,
  createBookingSupabase,
  approveBookingSupabase,
  rejectBookingSupabase,
  cancelBookingSupabase,
  getStatsSupabase,
  getAuditLogsSupabase,
  getUsersSupabase,
  provisionUserSupabase,
  getNotificationsSupabase,
  markNotificationsReadSupabase
} from "./supabase.js";

// Local fallback database operations for offline testing & development
import {
  getUserByPrn,
  getUserByEmail,
  getUserById,
  listUsers,
  createUser,
  getVenues as getVenuesSqlite,
  createVenue as createVenueSqlite,
  updateVenue as updateVenueSqlite,
  getBookings as getBookingsSqlite,
  createBooking as createBookingSqlite,
  approveBooking as approveBookingSqlite,
  rejectBooking as rejectBookingSqlite,
  cancelBooking as cancelBookingSqlite,
  getStats as getStatsSqlite,
  getAuditLogs as getAuditLogsSqlite,
  getNotifications as getNotificationsSqlite,
  markNotificationsRead as markNotificationsReadSqlite
} from "./db.js";
import { verifyJwt, verifyPassword, signJwt } from "./auth.js";

export const app = express();

/**
 * Determine whether to route through Supabase.
 * In production or when Supabase is configured:
 *  - Enforces Supabase strictly.
 *  - If unreachable or offline, throws a 503 error instead of silently falling back to SQLite.
 * In unit testing mode (process.env.NODE_ENV === "test" && !TEST_WITH_LIVE_SUPABASE):
 *  - Returns false to test against predictable local database mocks.
 */
export async function useSupabase() {
  if (process.env.NODE_ENV === "test" && process.env.TEST_WITH_LIVE_SUPABASE !== "true") {
    return false;
  }

  if (isSupabaseConfigured) {
    const online = await isSupabaseOnline();
    if (!online) {
      const err = new Error("Supabase cloud service is unreachable at the configured URL. Check network connection or project status.");
      err.status = 503;
      throw err;
    }
    return true;
  }

  if (process.env.NODE_ENV === "production") {
    const err = new Error("Supabase credentials are required in production environment. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    err.status = 503;
    throw err;
  }

  return false;
}

export function handleApiError(res, err, defaultStatus = 500) {
  const isSchemaError = err.message && (
    err.message.includes("Could not find the table") ||
    err.message.includes("relation \"public.") ||
    err.message.includes("schema cache")
  );
  const status = err.status || (isSchemaError ? 503 : defaultStatus);
  const message = isSchemaError
    ? "Supabase database schema is not initialized. Please run supabase/schema.sql in your Supabase Dashboard SQL Editor."
    : err.message;
  return res.status(status).json({ error: message });
}

// Middleware
app.use(express.json());

// CORS headers
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Authentication Middleware
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.substring(7).trim();

  // 1. Verify with Supabase Auth when Supabase is enabled
  try {
    if (await useSupabase()) {
      const user = await verifySupabaseToken(token);
      if (!user) {
        return res.status(401).json({ error: "Invalid or expired Supabase session" });
      }
      req.user = user;
      return next();
    }
  } catch (err) {
    return handleApiError(res, err, 503);
  }

  // 2. Fallback verification for offline local development & unit tests
  const payload = verifyJwt(token);
  if (!payload || !payload.userId) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const localUser = getUserById(payload.userId);
  if (!localUser || localUser.account_status !== "active") {
    return res.status(401).json({ error: "User account inactive or not found" });
  }

  req.user = localUser;
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access forbidden: requires ${allowedRoles.join(" or ")} role` });
    }
    next();
  };
}

// -------------------------------------------------------------
// SYSTEM STATUS
// -------------------------------------------------------------
app.get("/api/system/status", async (req, res) => {
  const inTestMode = process.env.NODE_ENV === "test" && process.env.TEST_WITH_LIVE_SUPABASE !== "true";
  const online = isSupabaseConfigured ? await isSupabaseOnline() : false;
  const schemaStatus = isSupabaseConfigured ? await checkSupabaseSchema() : { ok: false, initialized: false };

  res.json({
    database: inTestMode
      ? "SQLite Local (Test Mode)"
      : isSupabaseConfigured
        ? (schemaStatus.initialized ? "Supabase PostgreSQL" : "Supabase PostgreSQL (Schema Pending)")
        : "SQLite Local",
    authentication: inTestMode
      ? "Local Verified (Test Mode)"
      : isSupabaseConfigured ? "Supabase Auth" : "Local Verified",
    isSupabaseConfigured,
    isSupabaseOnline: online,
    isSchemaInitialized: schemaStatus.initialized,
    schemaDetails: schemaStatus.initialized
      ? "All tables and RLS active"
      : (schemaStatus.error || "Pending execution of supabase/schema.sql"),
    fallbackAllowed: inTestMode,
    mode: process.env.NODE_ENV || "development",
    status: isSupabaseConfigured
      ? (online && schemaStatus.initialized ? "healthy" : "action_required")
      : "healthy"
  });
});

// -------------------------------------------------------------
// AUTHENTICATION ENDPOINTS
// -------------------------------------------------------------

// 1. Student Login (PRN-Based)
app.post("/api/auth/student-login", async (req, res) => {
  const { prn, password } = req.body;
  if (!prn || !password) {
    return res.status(400).json({ error: "Please enter your student PRN and password" });
  }

  try {
    if (await useSupabase()) {
      const result = await loginStudentSupabase(prn, password);
      return res.json({
        token: result.token,
        session: result.session,
        user: result.user,
        message: "Student authenticated via Supabase Auth"
      });
    }

    // Local fallback
    const user = getUserByPrn(prn);
    if (!user) {
      return res.status(401).json({ error: `PRN "${prn}" is not registered in the student roster.` });
    }
    if (user.role !== "student") {
      return res.status(403).json({ error: "This login is strictly for students." });
    }
    if (user.account_status !== "active") {
      return res.status(403).json({ error: "Student account inactive." });
    }
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid PRN or password." });
    }

    const token = signJwt({ userId: user.id, role: user.role, prn: user.prn });
    const { password_hash, ...safe } = user;
    return res.json({ token, user: safe, message: "Student signed in" });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ error: err.message });
  }
});

// 2. Teacher Login (College Email)
app.post("/api/auth/teacher-login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Please enter your college email and password" });
  }

  try {
    if (await useSupabase()) {
      const result = await loginTeacherSupabase(email, password);
      return res.json({
        token: result.token,
        session: result.session,
        user: result.user,
        message: "Teacher authenticated via Supabase Auth"
      });
    }

    // Local fallback
    const user = getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: `Email "${email}" is not authorized for faculty access.` });
    }
    if (user.role !== "teacher") {
      return res.status(403).json({ error: "This portal is strictly for authorized teachers." });
    }
    if (user.account_status !== "active") {
      return res.status(403).json({ error: "Teacher account inactive." });
    }
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = signJwt({ userId: user.id, role: user.role, email: user.email });
    const { password_hash, ...safe } = user;
    return res.json({ token, user: safe, message: "Teacher signed in" });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ error: err.message });
  }
});

// 3. Admin Login (Administrator Gateway)
app.post("/api/auth/admin-login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Please enter administrator credentials" });
  }

  try {
    if (await useSupabase()) {
      const result = await loginAdminSupabase(email, password);
      return res.json({
        token: result.token,
        session: result.session,
        user: result.user,
        message: "Administrator authenticated via Supabase Auth"
      });
    }

    // Local fallback
    const user = getUserByEmail(email);
    if (!user || user.role !== "admin") {
      return res.status(401).json({ error: "Administrator authorization failed. Invalid credentials or insufficient privileges." });
    }
    if (user.account_status !== "active") {
      return res.status(403).json({ error: "Administrator account inactive." });
    }
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid administrator credentials." });
    }

    const token = signJwt({ userId: user.id, role: user.role, email: user.email });
    const { password_hash, ...safe } = user;
    return res.json({ token, user: safe, message: "Administrator signed in" });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ error: err.message });
  }
});

// 4. Current User Session
app.get("/api/auth/me", authenticate, async (req, res) => {
  const online = await useSupabase();
  res.json({
    user: req.user,
    provider: online ? "supabase" : "local_sqlite"
  });
});

// 5. Password Recovery
app.post("/api/auth/recover-password", (req, res) => {
  res.json({
    success: true,
    message: "If an authorized institutional account matches this identifier, password recovery instructions have been sent."
  });
});

// -------------------------------------------------------------
// VENUE ENDPOINTS
// -------------------------------------------------------------

app.get("/api/venues", async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    if (await useSupabase()) {
      const venues = await getVenuesSupabase(includeInactive);
      return res.json({ venues });
    }
    const venues = getVenuesSqlite({ includeInactive });
    res.json({ venues });
  } catch (err) {
    handleApiError(res, err, 500);
  }
});

app.post("/api/venues", authenticate, requireRole("admin"), async (req, res) => {
  try {
    if (await useSupabase()) {
      const venue = await createVenueSupabase(req.body);
      return res.status(201).json({ venue, message: "Venue created in Supabase" });
    }
    const venue = createVenueSqlite(req.body);
    res.status(201).json({ venue, message: "Venue created" });
  } catch (err) {
    handleApiError(res, err, 400);
  }
});

app.put("/api/venues/:id", authenticate, requireRole("admin"), async (req, res) => {
  try {
    if (await useSupabase()) {
      const venue = await updateVenueSupabase(req.params.id, req.body);
      return res.json({ venue, message: "Venue updated in Supabase" });
    }
    const venue = updateVenueSqlite(req.params.id, req.body);
    res.json({ venue, message: "Venue updated" });
  } catch (err) {
    handleApiError(res, err, 400);
  }
});

// -------------------------------------------------------------
// BOOKING ENDPOINTS
// -------------------------------------------------------------

app.get("/api/bookings", authenticate, async (req, res) => {
  try {
    const params = {
      userId: req.user.id,
      role: req.user.role,
      status: req.query.status,
      venue_id: req.query.venue_id,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      search: req.query.search
    };

    if (await useSupabase()) {
      const bookings = await getBookingsSupabase(params);
      return res.json({ bookings });
    }

    const bookings = getBookingsSqlite(params);
    res.json({ bookings });
  } catch (err) {
    handleApiError(res, err, 500);
  }
});

app.post("/api/bookings", authenticate, async (req, res) => {
  try {
    const bookingPayload = {
      requester_id: req.user.id,
      venue_id: req.body.venue_id,
      event_name: req.body.event_name,
      event_type: req.body.event_type || "Academic",
      event_date: req.body.event_date,
      start_time: req.body.start_time,
      end_time: req.body.end_time,
      attendee_count: req.body.attendee_count,
      purpose: req.body.purpose
    };

    if (await useSupabase()) {
      const booking = await createBookingSupabase(bookingPayload);
      return res.status(201).json({ booking, message: "Booking created in Supabase" });
    }

    const booking = createBookingSqlite(bookingPayload);
    res.status(201).json({ booking, message: "Booking created" });
  } catch (err) {
    const status = err.code === "CONFLICT" ? 409 : 400;
    handleApiError(res, err, status);
  }
});

// Admin Approval or Rejection
app.put("/api/bookings/:id/status", authenticate, requireRole("admin"), async (req, res) => {
  const { status, reason } = req.body;
  const bookingId = req.params.id;

  if (!status || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
  }

  const ipAddress = req.ip || "127.0.0.1";

  try {
    if (await useSupabase()) {
      if (status === "approved") {
        await approveBookingSupabase({ bookingId, adminId: req.user.id });
      } else {
        await rejectBookingSupabase({ bookingId, adminId: req.user.id, reason });
      }
      return res.json({ success: true, message: `Booking ${status} in Supabase` });
    }

    let updated;
    if (status === "approved") {
      updated = approveBookingSqlite({ bookingId, adminId: req.user.id, ipAddress });
    } else {
      updated = rejectBookingSqlite({ bookingId, adminId: req.user.id, reason, ipAddress });
    }
    res.json({ booking: updated, message: `Booking ${status}` });
  } catch (err) {
    const code = err.code === "CONFLICT" || err.status === 409 ? 409 : 400;
    handleApiError(res, err, code);
  }
});

// Cancel Own Booking
app.put("/api/bookings/:id/cancel", authenticate, async (req, res) => {
  try {
    if (await useSupabase()) {
      await cancelBookingSupabase({ bookingId: req.params.id, userId: req.user.id });
      return res.json({ success: true, message: "Booking cancelled in Supabase" });
    }
    const updated = cancelBookingSqlite({ bookingId: req.params.id, userId: req.user.id });
    res.json({ booking: updated, message: "Booking cancelled" });
  } catch (err) {
    handleApiError(res, err, 400);
  }
});

// -------------------------------------------------------------
// ADMIN METRICS, DIRECTORY & AUDIT LOGS
// -------------------------------------------------------------

app.get("/api/admin/stats", authenticate, requireRole("admin"), async (req, res) => {
  try {
    if (await useSupabase()) {
      const stats = await getStatsSupabase();
      return res.json({ stats });
    }
    const stats = getStatsSqlite();
    res.json({ stats });
  } catch (err) {
    handleApiError(res, err, 500);
  }
});

app.get("/api/admin/users", authenticate, requireRole("admin"), async (req, res) => {
  try {
    if (await useSupabase()) {
      const users = await getUsersSupabase({ role: req.query.role, search: req.query.search });
      return res.json({ users });
    }
    const users = listUsers({ role: req.query.role, search: req.query.search });
    res.json({ users });
  } catch (err) {
    handleApiError(res, err, 500);
  }
});

app.post("/api/admin/users", authenticate, requireRole("admin"), async (req, res) => {
  try {
    if (await useSupabase()) {
      const user = await provisionUserSupabase(req.body);
      return res.status(201).json({ user, message: "User provisioned in Supabase Auth & PostgreSQL" });
    }
    const user = createUser(req.body);
    res.status(201).json({ user, message: "User provisioned" });
  } catch (err) {
    handleApiError(res, err, 400);
  }
});

app.get("/api/admin/audit-logs", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    if (await useSupabase()) {
      const logs = await getAuditLogsSupabase(limit);
      return res.json({ logs });
    }
    const logs = getAuditLogsSqlite({ limit });
    res.json({ logs });
  } catch (err) {
    handleApiError(res, err, 500);
  }
});

// -------------------------------------------------------------
// NOTIFICATIONS
// -------------------------------------------------------------

app.get("/api/notifications", authenticate, async (req, res) => {
  try {
    if (await useSupabase()) {
      const notifications = await getNotificationsSupabase(req.user.id);
      return res.json({ notifications });
    }
    const notifications = getNotificationsSqlite(req.user.id);
    res.json({ notifications });
  } catch (err) {
    handleApiError(res, err, 500);
  }
});

app.post("/api/notifications/mark-read", authenticate, async (req, res) => {
  try {
    if (await useSupabase()) {
      await markNotificationsReadSupabase(req.user.id);
      return res.json({ success: true });
    }
    markNotificationsReadSqlite(req.user.id);
    res.json({ success: true });
  } catch (err) {
    handleApiError(res, err, 500);
  }
});
