export interface TodayClassDto {
  section_id: string;
  course_code: string;
  course_title: string;
  starts_at: string;
  ends_at: string;
  room: string | null;
  campus: string | null;
  instructor: string | null;
  /**
   * Minutes until this class starts, in the UNIVERSITY's timezone. Negative
   * while it is running. The server computes this rather than the client,
   * because the client's clock is in the phone's zone and a student who has
   * travelled would otherwise see every class shifted.
   */
  starts_in_minutes: number;
  is_in_progress: boolean;
}

export interface TodayDeadlineDto {
  id: string;
  title: string;
  course_code: string;
  due_at: string;
  /** Whole days until due; 0 means today. */
  days_left: number;
}

export interface TodayPostDto {
  id: string;
  title: string;
  board_name: string;
  board_slug: string;
  score: number;
  comment_count: number;
}

export interface TodayDto {
  /** Local date in the university's timezone, not the server's. */
  date: string;
  /** ISO-8601 weekday, 1 = Monday. */
  weekday: number;
  timezone: string;
  remaining_classes: TodayClassDto[];
  deadlines: TodayDeadlineDto[];
  hot_posts: TodayPostDto[];
}
