import { test, describe } from "node:test";
import assert from "node:assert";
import {
  getUserByPrn,
  getUserByEmail,
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

describe("Phase 3 & 4: Booking Workflow, Validation & Conflict Prevention", () => {
  const student = getUserByPrn("PRN2024001");
  const teacher = getUserByEmail("prof.sharma@mitaoe.ac.in");
  const admin = getUserByEmail("admin@mitaoe.ac.in");

  // Generate unique future date for conflict tests so test runs are idempotent
  const future = new Date();
  future.setDate(future.getDate() + 100 + Math.floor(Math.random() * 500));
  const testDate = future.toISOString().split("T")[0];

  test("10. A new booking request is created with initial status 'pending'", () => {
    const booking = createBooking({
      requester_id: student.id,
      venue_id: "v1", // Main Auditorium (capacity 500)
      event_name: "Annual Technical Symposium",
      event_type: "Academic",
      event_date: testDate,
      start_time: "09:00",
      end_time: "12:00",
      attendee_count: 250,
      purpose: "Campus technical paper presentations and keynote lectures."
    });

    assert.ok(booking.id);
    assert.strictEqual(booking.status, "pending");
    assert.strictEqual(booking.requester_id, student.id);
    assert.strictEqual(booking.attendee_count, 250);
  });

  test("11. Venue capacity violations are strictly rejected", () => {
    // Conference Room (v4) capacity is 24
    assert.throws(
      () => {
        createBooking({
          requester_id: student.id,
          venue_id: "v4",
          event_name: "Oversized Seminar",
          event_type: "Seminar",
          event_date: testDate,
          start_time: "14:00",
          end_time: "15:00",
          attendee_count: 100, // 100 exceeds capacity 24
          purpose: "Testing capacity enforcement"
        });
      },
      /exceeds venue maximum capacity/,
      "Capacity violation must throw error"
    );
  });

  test("12. Invalid time slots (end time before or equal start time) are rejected", () => {
    assert.throws(
      () => {
        createBooking({
          requester_id: student.id,
          venue_id: "v1",
          event_name: "Time inversion test",
          event_type: "Academic",
          event_date: testDate,
          start_time: "16:00",
          end_time: "15:00",
          attendee_count: 10,
          purpose: "Testing start before end"
        });
      },
      /Start time must be strictly earlier than end time/
    );
  });

  test("13. Inactive venues cannot receive booking requests", () => {
    // Create an inactive venue
    const inactiveVenue = createVenue({
      name: "Temporary Renovation Hall " + Date.now(),
      category: "Hall",
      location: "West Wing",
      capacity: 50,
      facilities: ["Wi-Fi"],
      description: "Under maintenance",
      is_active: 0
    });

    assert.throws(
      () => {
        createBooking({
          requester_id: teacher.id,
          venue_id: inactiveVenue.id,
          event_name: "Lecture in closed hall",
          event_type: "Academic",
          event_date: testDate,
          start_time: "10:00",
          end_time: "11:00",
          attendee_count: 20,
          purpose: "Testing inactive venue restriction"
        });
      },
      /inactive and cannot accept bookings/
    );
  });

  test("14. Administrator can approve a valid pending request", () => {
    const booking = createBooking({
      requester_id: teacher.id,
      venue_id: "v3", // Seminar Hall B
      event_name: "VLSI Architecture Seminar",
      event_type: "Seminar",
      event_date: testDate,
      start_time: "14:00",
      end_time: "16:00",
      attendee_count: 50,
      purpose: "Guest lecture on VLSI architecture by industry experts."
    });

    const approved = approveBooking({
      bookingId: booking.id,
      adminId: admin.id
    });

    assert.strictEqual(approved.status, "approved");
    assert.strictEqual(approved.reviewed_by, admin.id);
    assert.ok(approved.reviewed_at);
  });

  test("15. Overlapping approved bookings for the same venue are strictly prevented", () => {
    // The previous test approved a booking on venue 'v3' on testDate from 14:00 to 16:00.
    // Try to create or approve an overlapping booking: 15:00 to 17:00
    assert.throws(
      () => {
        createBooking({
          requester_id: student.id,
          venue_id: "v3",
          event_name: "Conflicting Coding Session",
          event_type: "Club Meeting",
          event_date: testDate,
          start_time: "15:00", // Overlaps with 14:00 - 16:00!
          end_time: "17:00",
          attendee_count: 40,
          purpose: "Should be blocked due to time conflict"
        });
      },
      /Time slot conflict/,
      "Overlapping booking request must be rejected"
    );
  });

  test("16. Administrator can reject a request with a recorded mandatory reason", () => {
    const booking = createBooking({
      requester_id: student.id,
      venue_id: "v5",
      event_name: "Late Night Gaming Tournament",
      event_type: "Cultural",
      event_date: testDate,
      start_time: "17:00",
      end_time: "19:00",
      attendee_count: 30,
      purpose: "Gaming event."
    });

    // Rejection without reason fails
    assert.throws(
      () => {
        rejectBooking({ bookingId: booking.id, adminId: admin.id, reason: "" });
      },
      /mandatory/
    );

    // Rejection with reason succeeds
    const rejected = rejectBooking({
      bookingId: booking.id,
      adminId: admin.id,
      reason: "Non-academic evening activities are not permitted in the Innovation Room."
    });

    assert.strictEqual(rejected.status, "rejected");
    assert.strictEqual(rejected.rejection_reason, "Non-academic evening activities are not permitted in the Innovation Room.");
    assert.strictEqual(rejected.reviewed_by, admin.id);
  });

  test("17. Requester can cancel their own pending booking", () => {
    const booking = createBooking({
      requester_id: student.id,
      venue_id: "v6",
      event_name: "Drama Club Practice",
      event_type: "Cultural",
      event_date: testDate,
      start_time: "10:00",
      end_time: "12:00",
      attendee_count: 20,
      purpose: "Rehearsal."
    });

    const cancelled = cancelBooking({ bookingId: booking.id, userId: student.id });
    assert.strictEqual(cancelled.status, "cancelled");
  });

  test("18. User cannot cancel another user's booking", () => {
    const booking = createBooking({
      requester_id: teacher.id,
      venue_id: "v6",
      event_name: "Staff Meeting",
      event_type: "Academic",
      event_date: testDate,
      start_time: "13:00",
      end_time: "14:00",
      attendee_count: 15,
      purpose: "Staff meeting."
    });

    assert.throws(
      () => {
        cancelBooking({ bookingId: booking.id, userId: student.id });
      },
      /Unauthorized/,
      "Users cannot cancel another user's booking"
    );
  });

  test("19. Dashboard statistics reflect accurate persisted records", () => {
    const stats = getStats();
    assert.ok(stats.totalRequests >= 5);
    assert.ok(stats.activeVenues >= 6);
    assert.ok(stats.approvedBookings >= 1);
    assert.ok(stats.rejectedRequests >= 1);
  });

  test("20. Multi-day booking with start_date and end_date is persisted and validated", () => {
    const futureStart = new Date();
    futureStart.setDate(futureStart.getDate() + 600);
    const startDateStr = futureStart.toISOString().split("T")[0];
    const futureEnd = new Date(futureStart);
    futureEnd.setDate(futureEnd.getDate() + 2);
    const endDateStr = futureEnd.toISOString().split("T")[0];

    const booking = createBooking({
      requester_id: student.id,
      venue_id: "v1",
      event_name: "MITAOE National Hackathon 2026",
      event_type: "Workshop",
      start_date: startDateStr,
      end_date: endDateStr,
      start_time: "09:00",
      end_time: "18:00",
      attendee_count: 300,
      purpose: "3-day continuous hackathon."
    });

    assert.ok(booking.id);
    assert.strictEqual(booking.start_date, startDateStr);
    assert.strictEqual(booking.end_date, endDateStr);
    assert.strictEqual(booking.event_date, startDateStr);

    // Ending date cannot precede starting date
    assert.throws(
      () => {
        createBooking({
          requester_id: student.id,
          venue_id: "v1",
          event_name: "Invalid Date Order",
          event_type: "Workshop",
          start_date: endDateStr,
          end_date: startDateStr,
          start_time: "09:00",
          end_time: "18:00",
          attendee_count: 50,
          purpose: "Testing invalid date bounds."
        });
      },
      /Ending date cannot be earlier than starting date/
    );
  });
});
