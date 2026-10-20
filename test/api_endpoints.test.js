import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
process.env.NODE_ENV = "test";
const { app } = await import("../server/app.js");

describe("Phase 5: HTTP REST API Endpoints & Security Boundaries (Express Backend)", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  async function api(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  test("API: Student login succeeds with valid PRN and fails with unknown PRN", async () => {
    // Valid student
    const res1 = await api("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify({ prn: "PRN2024001", password: "Student@MITAOE2026" })
    });
    assert.strictEqual(res1.status, 200);
    assert.ok(res1.data.token);
    assert.strictEqual(res1.data.user.role, "student");
    assert.strictEqual(res1.data.user.prn, "PRN2024001");

    // Unknown PRN
    const res2 = await api("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify({ prn: "PRN9999999", password: "AnyPassword" })
    });
    assert.strictEqual(res2.status, 401);
    assert.match(res2.data.error, /not registered/);

    // Bad password
    const res3 = await api("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify({ prn: "PRN2024001", password: "WrongPassword" })
    });
    assert.strictEqual(res3.status, 401);
  });

  test("API: Teacher login verifies assigned college email", async () => {
    // Valid teacher
    const res1 = await api("/api/auth/teacher-login", {
      method: "POST",
      body: JSON.stringify({ email: "prof.sharma@mitaoe.ac.in", password: "Teacher@MITAOE2026" })
    });
    assert.strictEqual(res1.status, 200);
    assert.ok(res1.data.token);
    assert.strictEqual(res1.data.user.role, "teacher");

    // Unauthorized email
    const res2 = await api("/api/auth/teacher-login", {
      method: "POST",
      body: JSON.stringify({ email: "random.user@external.com", password: "Teacher@MITAOE2026" })
    });
    assert.strictEqual(res2.status, 401);
  });

  test("API: Admin login gives administrator access and blocks non-admins", async () => {
    // Valid admin
    const resAdmin = await api("/api/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@mitaoe.ac.in", password: "Admin@MITAOE2026" })
    });
    assert.strictEqual(resAdmin.status, 200);
    assert.strictEqual(resAdmin.data.user.role, "admin");

    // Teacher trying admin login
    const resForbidden = await api("/api/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ email: "prof.sharma@mitaoe.ac.in", password: "Teacher@MITAOE2026" })
    });
    assert.strictEqual(resForbidden.status, 401);
  });

  test("API: Role Authorization prevents Student from accessing Admin APIs", async () => {
    // Get student token
    const studentLogin = await api("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify({ prn: "PRN2024001", password: "Student@MITAOE2026" })
    });
    const studentToken = studentLogin.data.token;

    // Student attempts to fetch admin stats
    const statsRes = await api("/api/admin/stats", {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(statsRes.status, 403, "Student must be forbidden from accessing admin stats");

    // Student attempts to create a venue
    const venueRes = await api("/api/venues", {
      method: "POST",
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        name: "Unauthorized Hall",
        category: "Hall",
        location: "Block C",
        capacity: 50
      })
    });
    assert.strictEqual(venueRes.status, 403, "Student must be forbidden from creating venues");
  });

  test("API: Admin can approve and reject bookings, and rejection requires reason", async () => {
    // 1. Get tokens
    const studentLogin = await api("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify({ prn: "PRN2024001", password: "Student@MITAOE2026" })
    });
    const studentToken = studentLogin.data.token;

    const adminLogin = await api("/api/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@mitaoe.ac.in", password: "Admin@MITAOE2026" })
    });
    const adminToken = adminLogin.data.token;

    // 2. Student creates a booking request
    const createRes = await api("/api/bookings", {
      method: "POST",
      headers: { Authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({
        venue_id: "v2",
        event_name: "Web3 Developer Workshop",
        event_type: "Workshop",
        event_date: new Date(Date.now() + 86400000 * (1000 + Math.floor(Math.random() * 5000))).toISOString().split("T")[0],
        start_time: "10:00",
        end_time: "12:00",
        attendee_count: 50,
        purpose: "Smart contract development seminar."
      })
    });
    assert.strictEqual(createRes.status, 201);
    const bookingId = createRes.data.booking.id;
    assert.strictEqual(createRes.data.booking.status, "pending");

    // 3. Admin rejects without reason -> should fail 400
    const failReject = await api(`/api/bookings/${bookingId}/status`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: "rejected", reason: "" })
    });
    assert.strictEqual(failReject.status, 400);

    // 4. Admin approves valid booking -> 200
    const approveRes = await api(`/api/bookings/${bookingId}/status`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: "approved" })
    });
    assert.strictEqual(approveRes.status, 200);
    assert.strictEqual(approveRes.data.booking.status, "approved");
  });
});
