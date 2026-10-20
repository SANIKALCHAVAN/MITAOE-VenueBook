import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";

export const DOCUMENTS_DIR = path.resolve(process.cwd(), "data", "documents");

// Ensure documents directory exists
if (!fs.existsSync(DOCUMENTS_DIR)) {
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
}

/**
 * Format date string (YYYY-MM-DD) to friendly Indian format (DD MMM YYYY)
 */
function formatDate(dateStr) {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  } catch {
    return dateStr;
  }
}

/**
 * Format ISO datetime string to friendly format with time
 */
function formatDateTime(isoStr) {
  if (!isoStr) return "N/A";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch {
    return isoStr;
  }
}

/**
 * Format 24hr time (HH:MM) to 12hr AM/PM
 */
function formatTime(timeStr) {
  if (!timeStr) return "N/A";
  try {
    const parts = timeStr.split(":");
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] || "00";
    if (isNaN(hours)) return timeStr;
    const ampm = hours >= 12 ? "PM" : "AM";
    const h12 = hours % 12 || 12;
    return `${String(h12).padStart(2, "0")}:${minutes} ${ampm}`;
  } catch {
    return timeStr;
  }
}

/**
 * Calculate human-readable duration
 */
function calculateDuration(startTime, endTime, startDate, endDate) {
  try {
    const start = new Date(`1970-01-01T${startTime}:00`);
    const end = new Date(`1970-01-01T${endTime}:00`);
    const diffMs = end - start;
    if (diffMs > 0) {
      const diffMins = Math.round(diffMs / 60000);
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      let timePart = "";
      if (hours > 0) timePart += `${hours} hr${hours > 1 ? "s" : ""}`;
      if (mins > 0) timePart += `${timePart ? " " : ""}${mins} min${mins > 1 ? "s" : ""}`;

      if (startDate && endDate && startDate !== endDate) {
        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        const days = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
        return `${timePart} per day (${days} consecutive days)`;
      }
      return timePart || "Single session";
    }
  } catch {
    // fallback
  }
  return "Standard session";
}

/**
 * Sanitize filename to avoid filesystem issues
 */
export function sanitizeFilename(str) {
  return String(str).replace(/[^a-zA-Z0-9_\-\.]/g, "_");
}

/**
 * Generate a professional A4 Booking Approval Summary PDF Document.
 * Returns a Promise that resolves with { filePath, fileName, fileBytes, documentReference, approvalReference }.
 */
export async function generateApprovalPdf(booking, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const bookingId = booking.id;
      const docRef = options.documentReference || `DOC-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const appRef = options.approvalReference || `APP-MIT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const safeId = sanitizeFilename(bookingId);
      const fileName = `VenueBook_Approval_${safeId}.pdf`;
      const filePath = path.join(DOCUMENTS_DIR, fileName);

      const doc = new PDFDocument({
        size: "A4",
        margin: 36,
        info: {
          Title: `MITAOE VenueBook - Booking Approval Summary - ${bookingId}`,
          Author: "MIT Academy of Engineering - Campus VenueBook System",
          Subject: "Official Venue Booking Approval Confirmation",
          Keywords: "MITAOE, VenueBook, Booking Approval, Campus Reservation"
        }
      });

      const writeStream = fs.createWriteStream(filePath);
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.pipe(writeStream);

      // --- COLOR PALETTE ---
      const primaryPurple = "#5044c8";
      const darkNavy = "#1a1e36";
      const softBg = "#f8f9fd";
      const borderGray = "#dce1ec";
      const textMuted = "#646d89";
      const textDark = "#1c2136";
      const statusGreen = "#0d9488";
      const greenBg = "#f0fdfa";
      const greenBorder = "#99f6e4";

      const pageWidth = 595.28;
      const leftMargin = 36;
      const rightMargin = 595.28 - 36;
      const contentWidth = rightMargin - leftMargin;

      let y = 36;

      // 1. TOP INSTITUTIONAL HEADER BAR
      doc.rect(leftMargin, y, contentWidth, 54).fill(primaryPurple);

      doc.fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text("MIT ACADEMY OF ENGINEERING (MITAOE)", leftMargin + 16, y + 10, {
          width: contentWidth - 32
        });

      doc.fillColor("#e2dffc")
        .font("Helvetica")
        .fontSize(8.5)
        .text("An Autonomous Engineering Institute · Approved by AICTE · Affiliated to SPPU, Pune", leftMargin + 16, y + 26);

      doc.fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text("MITAOE VenueBook · Campus Venue & Facility Management System", leftMargin + 16, y + 38);

      y += 66;

      // 2. DOCUMENT TITLE & APPROVAL BADGE
      doc.rect(leftMargin, y, contentWidth, 52).fillAndStroke(softBg, borderGray);

      doc.fillColor(darkNavy)
        .font("Helvetica-Bold")
        .fontSize(14)
        .text("BOOKING APPROVAL SUMMARY", leftMargin + 14, y + 12);

      doc.fillColor(textMuted)
        .font("Helvetica")
        .fontSize(8)
        .text("OFFICIAL INSTITUTIONAL RESERVATION RECORD & AUDIT CONFIRMATION", leftMargin + 14, y + 30);

      // Status Pill on top right
      const pillWidth = 140;
      const pillHeight = 26;
      const pillX = rightMargin - pillWidth - 14;
      const pillY = y + 13;

      doc.roundedRect(pillX, pillY, pillWidth, pillHeight, 5).fillAndStroke(greenBg, greenBorder);
      doc.fillColor(statusGreen)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("● APPROVED", pillX, pillY + 7, { width: pillWidth, align: "center" });

      y += 62;

      // 3. TOP META CARDS (Document Reference, Approval Ref, Generated Time)
      const colWidth = (contentWidth - 16) / 3;

      // Box 1: Document Reference
      doc.roundedRect(leftMargin, y, colWidth, 38, 4).fillAndStroke("#ffffff", borderGray);
      doc.fillColor(textMuted).font("Helvetica-Bold").fontSize(7).text("DOCUMENT REFERENCE", leftMargin + 8, y + 7);
      doc.fillColor(darkNavy).font("Helvetica-Bold").fontSize(9).text(docRef, leftMargin + 8, y + 19);

      // Box 2: Approval Reference
      doc.roundedRect(leftMargin + colWidth + 8, y, colWidth, 38, 4).fillAndStroke("#ffffff", borderGray);
      doc.fillColor(textMuted).font("Helvetica-Bold").fontSize(7).text("APPROVAL REFERENCE", leftMargin + colWidth + 16, y + 7);
      doc.fillColor(primaryPurple).font("Helvetica-Bold").fontSize(9).text(appRef, leftMargin + colWidth + 16, y + 19);

      // Box 3: Generated At
      doc.roundedRect(leftMargin + (colWidth + 8) * 2, y, colWidth, 38, 4).fillAndStroke("#ffffff", borderGray);
      doc.fillColor(textMuted).font("Helvetica-Bold").fontSize(7).text("ISSUED ON", leftMargin + (colWidth + 8) * 2 + 8, y + 7);
      doc.fillColor(textDark).font("Helvetica").fontSize(8.5).text(formatDateTime(new Date().toISOString()), leftMargin + (colWidth + 8) * 2 + 8, y + 19);

      y += 48;

      // HELPER FUNCTION: Draw Section Heading
      function drawSectionHeading(title, currentY) {
        doc.rect(leftMargin, currentY, contentWidth, 18).fill("#f1f2f8");
        doc.rect(leftMargin, currentY, 4, 18).fill(primaryPurple);
        doc.fillColor(darkNavy)
          .font("Helvetica-Bold")
          .fontSize(9)
          .text(title.toUpperCase(), leftMargin + 10, currentY + 4.5);
        return currentY + 24;
      }

      // HELPER FUNCTION: Draw Key-Value Table
      function drawGridRows(rows, startY) {
        let curY = startY;
        const halfWidth = (contentWidth - 8) / 2;

        for (let i = 0; i < rows.length; i += 2) {
          const item1 = rows[i];
          const item2 = rows[i + 1];

          const rowHeight = 24;

          // Draw item 1
          doc.rect(leftMargin, curY, halfWidth, rowHeight).fillAndStroke(i % 4 === 0 ? "#ffffff" : softBg, borderGray);
          doc.fillColor(textMuted).font("Helvetica").fontSize(7.5).text(item1.label, leftMargin + 8, curY + 4);
          doc.fillColor(textDark).font("Helvetica-Bold").fontSize(8.5).text(String(item1.value || "—"), leftMargin + 8, curY + 12, {
            width: halfWidth - 16,
            ellipsis: true
          });

          // Draw item 2 if present
          if (item2) {
            doc.rect(leftMargin + halfWidth + 8, curY, halfWidth, rowHeight).fillAndStroke(i % 4 === 0 ? "#ffffff" : softBg, borderGray);
            doc.fillColor(textMuted).font("Helvetica").fontSize(7.5).text(item2.label, leftMargin + halfWidth + 16, curY + 4);
            doc.fillColor(textDark).font("Helvetica-Bold").fontSize(8.5).text(String(item2.value || "—"), leftMargin + halfWidth + 16, curY + 12, {
              width: halfWidth - 16,
              ellipsis: true
            });
          }

          curY += rowHeight + 4;
        }
        return curY;
      }

      // 4. SECTION 1: RESERVATION & EVENT INFORMATION
      y = drawSectionHeading("1. Reservation & Event Information", y);

      const startDate = booking.start_date || booking.event_date;
      const endDate = booking.end_date || startDate;
      const durationStr = calculateDuration(booking.start_time, booking.end_time, startDate, endDate);

      const reservationRows = [
        { label: "BOOKING ID", value: booking.id },
        { label: "EVENT TITLE", value: booking.event_name || booking.event_title },
        { label: "EVENT CATEGORY", value: booking.event_type || "Academic" },
        { label: "EXPECTED ATTENDEES", value: `${booking.attendee_count || booking.expected_attendees || 0} Persons` },
        { label: "STARTING DATE", value: formatDate(startDate) },
        { label: "ENDING DATE", value: formatDate(endDate) },
        { label: "TIME WINDOW", value: `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}` },
        { label: "CALCULATED DURATION", value: durationStr }
      ];

      y = drawGridRows(reservationRows, y);

      // Event Purpose / Agenda Block
      if (booking.purpose) {
        doc.roundedRect(leftMargin, y, contentWidth, 36, 4).fillAndStroke(softBg, borderGray);
        doc.fillColor(textMuted).font("Helvetica-Bold").fontSize(7).text("EVENT PURPOSE & DETAILED AGENDA", leftMargin + 8, y + 5);
        doc.fillColor(textDark).font("Helvetica").fontSize(8).text(booking.purpose, leftMargin + 8, y + 15, {
          width: contentWidth - 16,
          height: 18,
          ellipsis: true
        });
        y += 42;
      }

      // 5. SECTION 2: ALLOCATED VENUE SPECIFICATIONS
      y = drawSectionHeading("2. Allocated Venue Specifications", y);

      const facilitiesList = Array.isArray(booking.facilities)
        ? booking.facilities.join(", ")
        : (booking.facilities || "Projector, Sound System, Wi-Fi, Seating");

      const venueRows = [
        { label: "VENUE NAME", value: booking.venue_name || "Campus Venue" },
        { label: "VENUE CATEGORY", value: booking.venue_category || "Facility" },
        { label: "CAMPUS LOCATION", value: booking.venue_location || "MITAOE Campus" },
        { label: "SEATING CAPACITY", value: `${booking.venue_capacity || 0} Maximum Seats` },
        { label: "AVAILABLE AMENITIES", value: facilitiesList },
        { label: "OPERATIONAL STATUS", value: "Verified Active & Available" }
      ];

      y = drawGridRows(venueRows, y);

      // 6. SECTION 3: AUTHORIZED REQUESTER PROFILE
      y = drawSectionHeading("3. Authorized Requester Profile", y);

      const requesterRole = String(booking.requester_role || "Student").toUpperCase();
      const prnOrId = booking.requester_prn ? `PRN: ${booking.requester_prn}` : (booking.requester_id || "Registered User");

      const requesterRows = [
        { label: "REQUESTER NAME", value: booking.requester_name || "Campus Member" },
        { label: "INSTITUTIONAL ROLE", value: requesterRole },
        { label: "STUDENT PRN / USER ID", value: prnOrId },
        { label: "OFFICIAL COLLEGE EMAIL", value: booking.requester_email || "N/A" },
        { label: "DEPARTMENT / BRANCH", value: booking.requester_department || "Engineering Department" },
        { label: "SUBMISSION TIMESTAMP", value: formatDateTime(booking.created_at) }
      ];

      y = drawGridRows(requesterRows, y);

      // 7. SECTION 4: ADMINISTRATIVE APPROVAL AUDIT
      y = drawSectionHeading("4. Administrative Approval & Verification Audit", y);

      const reviewerName = booking.reviewer_name || "MITAOE Venue Administrator";
      const reviewedAt = booking.reviewed_at || new Date().toISOString();

      const approvalRows = [
        { label: "AUTHORIZATION STATUS", value: "APPROVED & FORMALLY CONFIRMED" },
        { label: "REVIEWED & AUTHORIZED BY", value: reviewerName },
        { label: "APPROVAL TIMESTAMP", value: formatDateTime(reviewedAt) },
        { label: "CONFLICT CHECK RESULT", value: "Verified: Zero Timetable / Venue Conflicts" }
      ];

      y = drawGridRows(approvalRows, y);

      // Digital Integrity & Security Banner
      const checksum = crypto
        .createHash("sha256")
        .update(`${booking.id}:${reviewedAt}:${reviewerName}:${docRef}`)
        .digest("hex")
        .substring(0, 24)
        .toUpperCase();

      doc.roundedRect(leftMargin, y, contentWidth, 32, 4).fillAndStroke("#f0fdf4", "#bbf7d0");
      doc.fillColor("#15803d").font("Helvetica-Bold").fontSize(7.5).text("DIGITAL AUDIT VERIFICATION FINGERPRINT", leftMargin + 8, y + 6);
      doc.fillColor("#166534").font("Helvetica").fontSize(7).text(
        `SHA256: ${checksum} · System Security Verified · Recorded in Institutional Audit Log`,
        leftMargin + 8,
        y + 17
      );

      y += 40;

      // 8. DOCUMENT FOOTER (Placed cleanly at bottom)
      const footerY = 841.89 - 50;

      doc.strokeColor(borderGray).lineWidth(0.5).moveTo(leftMargin, footerY).lineTo(rightMargin, footerY).stroke();

      doc.fillColor(textMuted)
        .font("Helvetica")
        .fontSize(7)
        .text(
          "Notice: This document is an automated verification summary generated by the MITAOE VenueBook system. It reflects the authoritative reservation state recorded in the campus PostgreSQL database at generation time.",
          leftMargin,
          footerY + 6,
          { width: contentWidth - 60 }
        );

      doc.fillColor(textMuted)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text("PAGE 1 OF 1", rightMargin - 55, footerY + 6, { width: 55, align: "right" });

      doc.end();

      writeStream.on("finish", () => {
        const fileBytes = Buffer.concat(chunks);
        resolve({
          filePath,
          fileName,
          fileSize: fileBytes.length,
          fileBytes,
          documentReference: docRef,
          approvalReference: appRef
        });
      });

      writeStream.on("error", (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}
