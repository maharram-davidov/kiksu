import type { AttendanceDto } from "./timetable.types";

/** `public.accent_color`. The student's own choice, which is why it lives on the enrollment. */
export const ACCENT_COLORS = [
  "turquoise", "bronze", "pomegranate", "indigo", "ink", "moss", "plum",
] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export const ENROLLMENT_STATES = ["enrolled", "dropped", "completed", "failed"] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];

/**
 * One row of the student's own timetable.
 *
 * Own rows only, always. There is no shape here for reading somebody else's
 * enrollments and no endpoint that would accept an `app_user_id` — a
 * timetable is a near-perfect movement profile of a named person, and the
 * course-plus-section combination on a small programme identifies its student
 * long before any name is attached (the k-anonymity concern in the brief).
 */
export interface EnrollmentDto {
  id: string;
  section_id: string;
  term_id: string;
  state: EnrollmentState;
  color: AccentColor;
  display_order: number | null;
  course: {
    id: string;
    code: string;
    title: string;
    short_title: string | null;
    credits: number | null;
  };
  section_code: string;
  instructor_name: string | null;
  attendance: AttendanceDto | null;
  final_letter: string | null;
  gpa_points: number | null;
}

export interface CreateEnrollmentInput {
  section_id: string;
  color?: AccentColor;
}

export interface UpdateEnrollmentInput {
  color?: AccentColor;
  display_order?: number;
  state?: EnrollmentState;
}

/** A section of a course, with the meetings that decide its week impact. */
export interface CourseSectionDto {
  id: string;
  section_code: string;
  capacity: number | null;
  enrolled_count: number;
  instructor_name: string | null;
  /** True when the caller already holds an `enrolled` row for this section. */
  is_enrolled: boolean;
  meetings: Array<{
    weekday: number;
    starts_at: string;
    ends_at: string;
    kind: string;
    room: string | null;
  }>;
}
