/** Mirrors the API's timetable DTOs. Kept minimal — only what screens render. */

export interface Meeting {
  section_id: string;
  course_code: string;
  course_title: string;
  /** ISO-8601 weekday: 1 = Monday (B.E). */
  weekday: number;
  starts_at: string;
  ends_at: string;
  room: string | null;
  campus: string | null;
  kind: string;
  instructor: string | null;
}

export interface WeekGrid {
  term: { id: string; label: string; starts_on: string; ends_on: string };
  /** The zone the wall-clock times above are interpreted in. Never an instant. */
  timezone: string;
  meetings: Meeting[];
}

export interface Attendance {
  section_id: string;
  course_code: string;
  course_title: string;
  absences: number;
  max_absences: number;
  expulsion_at: number;
  used_ratio: number;
  is_warning: boolean;
  is_barred: boolean;
}
