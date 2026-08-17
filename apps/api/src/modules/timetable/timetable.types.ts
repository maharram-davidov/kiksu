/** Response shapes for the timetable module. Mirrors `05-openapi.yaml`. */

/** One meeting on the week grid. */
export interface MeetingDto {
  section_id: string;
  course_code: string;
  course_title: string;
  /** ISO-8601 weekday: 1 = Monday (B.E). */
  weekday: number;
  /** Wall-clock local to the university's timezone, "HH:MM". Not an instant. */
  starts_at: string;
  ends_at: string;
  room: string | null;
  campus: string | null;
  kind: string;
  instructor: string | null;
}

export interface WeekGridDto {
  term: { id: string; label: string; starts_on: string; ends_on: string };
  /** IANA zone the `starts_at`/`ends_at` wall-clock values are interpreted in. */
  timezone: string;
  meetings: MeetingDto[];
}

/**
 * Attendance for one enrolled course. The server returns the limit, the count
 * AND the derived ratio so the client never has to reimplement absence policy
 * arithmetic — the design renders "4 / 12" beside "33% of the allowed absences
 * used", and both must agree with the server's view of the rules.
 */
export interface AttendanceDto {
  section_id: string;
  course_code: string;
  course_title: string;
  absences: number;
  max_absences: number;
  expulsion_at: number;
  /** absences / max_absences, 0..1+, rounded to 4dp. */
  used_ratio: number;
  /** True once the university's warn threshold is crossed. */
  is_warning: boolean;
  /** True when the student can no longer sit the exam. */
  is_barred: boolean;
}

export interface CourseSearchItemDto {
  course_id: string;
  code: string;
  title: string;
  credits: number | null;
  instructors: string[];
}


/**
 * Everything the class detail sheet needs, in one call.
 *
 * The sheet opens from a tap on the week grid, so it must not stall — and it
 * shows six different things (times, room, instructor, attendance, and three
 * link counts) that would otherwise be six round trips on campus wifi.
 */
export interface ClassDetailDto {
  section_id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  credits: number | null;
  section_code: string | null;
  meetings: Array<{
    weekday: number;
    starts_at: string;
    ends_at: string;
    room: string | null;
    campus: string | null;
    kind: string;
  }>;
  instructor: {
    id: string;
    full_name: string;
    title_prefix: string | null;
    /** Links the sheet straight into the reviews profile. */
    rating_avg: number | null;
    review_count: number;
  } | null;
  attendance: {
    absences: number;
    max_absences: number;
    expulsion_at: number;
    used_ratio: number;
    is_warning: boolean;
    is_barred: boolean;
  };
  /** The design's "14 fayl", "38 mövzu", "61 rəy" row. */
  material_count: number;
  board_topic_count: number;
  review_count: number;
  /** Null when the caller is not enrolled — the sheet then hides recording. */
  enrollment_id: string | null;
}
