import auditoriumImg from "../imgs/Modern Auditorium Conference Hall.png";
import innovationImg from "../imgs/Modern High-Tech Innovation Room.png";
import seminarAImg from "../imgs/Modern Seminar Hall A.png";
import seminarBImg from "../imgs/Modern Seminar Hall B.png";
import boardroomImg from "../imgs/Modern Wood-Toned Corporate Boardroom.png";
import activityImg from "../imgs/Spacious Modern Activity Hall.png";

/**
 * Centralized mapping configuration for MITAOE Campus Venues.
 * Keys support venue ID (e.g., 'v1') or normalized venue names (e.g., 'Main Auditorium').
 */
export const VENUE_IMAGES = {
  // Key by ID
  v1: auditoriumImg,
  v2: seminarAImg,
  v3: seminarBImg,
  v4: boardroomImg,
  v5: innovationImg,
  v6: activityImg,

  // Key by normalized name (safe for Supabase or custom DB seeds)
  "main auditorium": auditoriumImg,
  "seminar hall a": seminarAImg,
  "seminar hall b": seminarBImg,
  "conference room": boardroomImg,
  "innovation room": innovationImg,
  "open activity space": activityImg,

  // Exact file metadata for reference
  metadata: {
    "Main Auditorium": { filename: "Modern Auditorium Conference Hall.png", dimensions: "1672x941" },
    "Seminar Hall A": { filename: "Modern Seminar Hall A.png", dimensions: "1672x941" },
    "Seminar Hall B": { filename: "Modern Seminar Hall B.png", dimensions: "1672x941" },
    "Conference Room": { filename: "Modern Wood-Toned Corporate Boardroom.png", dimensions: "1672x941" },
    "Innovation Room": { filename: "Modern High-Tech Innovation Room.png", dimensions: "1672x941" },
    "Open Activity Space": { filename: "Spacious Modern Activity Hall.png", dimensions: "1672x941" }
  }
};

/**
 * Resolves the appropriate venue photograph.
 * Handles venue object, ID, or name with fallback support.
 */
export function getVenueImage(venue) {
  if (!venue) return null;

  // Direct image URL provided on venue record
  if (venue.image_url) return venue.image_url;

  // Lookup by ID
  if (venue.id && VENUE_IMAGES[venue.id]) {
    return VENUE_IMAGES[venue.id];
  }

  // Lookup by normalized name
  if (venue.name) {
    const key = venue.name.trim().toLowerCase();
    if (VENUE_IMAGES[key]) {
      return VENUE_IMAGES[key];
    }
  }

  // Lookup if passed as a string ID directly
  if (typeof venue === "string" && VENUE_IMAGES[venue.toLowerCase()]) {
    return VENUE_IMAGES[venue.toLowerCase()];
  }

  return null;
}
