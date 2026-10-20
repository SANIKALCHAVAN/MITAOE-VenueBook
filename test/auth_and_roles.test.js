import { test, describe } from "node:test";
import assert from "node:assert";
import {
  getUserByPrn,
  getUserByEmail,
  getUserById,
  createUser,
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
  getStats
} from "../server/db.js";
import { verifyPassword, signJwt, verifyJwt } from "../server/auth.js";

describe("Phase 2: Authentication & Role Verification", () => {
  test("1. Unauthenticated / invalid token cannot decode to authorized user", () => {
    assert.strictEqual(verifyJwt(""), null);
    assert.strictEqual(verifyJwt("invalid.token.here"), null);
    assert.strictEqual(verifyJwt("eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJmYWtlIn0.badsig"), null);
  });

  test("2. Valid registered student can sign in using supported PRN flow", () => {
    const student = getUserByPrn("PRN2024001");
    assert.ok(student, "Pre-provisioned student must exist");
    assert.strictEqual(student.role, "student");
    assert.strictEqual(student.prn, "PRN2024001");
    assert.strictEqual(student.account_status, "active");

    const validPassword = verifyPassword("Student@MITAOE2026", student.password_hash);
    assert.strictEqual(validPassword, true, "Password verification must succeed for valid credentials");

    const token = signJwt({ userId: student.id, role: student.role, prn: student.prn });
    const decoded = verifyJwt(token);
    assert.ok(decoded);
    assert.strictEqual(decoded.userId, student.id);
    assert.strictEqual(decoded.role, "student");
  });

  test("3. Unknown PRN cannot create an authorized student identity", () => {
    const unknown = getUserByPrn("PRN9999999");
    assert.strictEqual(unknown, null, "Unknown PRN must not exist in authorized roster");
  });

  test("4. Authorized teacher can sign in using assigned verified email", () => {
    const teacher = getUserByEmail("prof.sharma@mitaoe.ac.in");
    assert.ok(teacher, "Teacher account must be pre-provisioned");
    assert.strictEqual(teacher.role, "teacher");
    assert.strictEqual(teacher.email_verified, 1);
    assert.strictEqual(teacher.account_status, "active");

    const validPassword = verifyPassword("Teacher@MITAOE2026", teacher.password_hash);
    assert.strictEqual(validPassword, true);
  });

  test("5. Unauthorized email cannot access teacher accounts", () => {
    const unauthorized = getUserByEmail("random.intruder@gmail.com");
    assert.strictEqual(unauthorized, null);
  });

  test("6 & 7. Student and Teacher roles cannot claim Administrator privileges", () => {
    const student = getUserByPrn("PRN2024001");
    const teacher = getUserByEmail("prof.sharma@mitaoe.ac.in");
    const admin = getUserByEmail("admin@mitaoe.ac.in");

    assert.notStrictEqual(student.role, "admin");
    assert.notStrictEqual(teacher.role, "admin");
    assert.strictEqual(admin.role, "admin");
  });

  test("8. Student cannot view another student's private bookings (Data Isolation)", () => {
    const student1 = getUserByPrn("PRN2024001");
    const student2 = getUserByPrn("PRN2024002");

    const s1Bookings = getBookings({ userId: student1.id, role: student1.role });
    for (const b of s1Bookings) {
      assert.strictEqual(b.requester_id, student1.id, "Student 1 must only see their own bookings");
      assert.notStrictEqual(b.requester_id, student2.id);
    }
  });

  test("9. Expired session token is rejected safely", () => {
    // Generate token expired 10 seconds ago
    const expiredToken = signJwt({ userId: "usr-stud-01", role: "student" }, -10);
    assert.strictEqual(verifyJwt(expiredToken), null, "Expired token must return null");
  });
});
