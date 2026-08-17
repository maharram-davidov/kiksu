/**
 * Marketplace and vacancy shapes.
 *
 * A seller is PSEUDONYMOUS but persistent — unlike a forum author, they carry
 * a handle and a trade rating. That is deliberate and it is the one place the
 * product trades anonymity for accountability: a seller with no reputation is
 * a scam waiting to happen, and a buyer meeting a stranger to hand over cash
 * needs something to go on. Reviews and forum posts stay unlinkable to this.
 */
export interface SellerDto {
  handle: string;
  avatar_id: number;
  university_code: string | null;
  verification_status: "card" | "email" | "none";
  trade_rating_avg: number | null;
  deal_count: number;
  response_rate_pct: number | null;
  response_time_median_sec: number | null;
  complaint_count: number;
}

export interface ListingDto {
  id: string;
  title: string;
  description: string | null;
  category_key: string;
  category_name: string;
  /** Integer minor units (qəpik). 25 ₼ is 2500. Never a float. */
  price_minor: number;
  currency: string;
  is_negotiable: boolean;
  condition: string;
  meetup_notes: string[];
  related_course_code: string | null;
  published_at: string;
  seller: SellerDto | null;
}

export interface VacancyDto {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  work_mode: string;
  city: string | null;
  is_paid: boolean;
  stipend_minor: number | null;
  currency: string;
  duration_months: number | null;
  hours_per_week: number | null;
  min_study_year: number | null;
  max_study_year: number | null;
  required_skills: string[];
  conversion_possible: boolean;
  transport_provided: boolean;
  schedule_friendly: boolean;
  apply_deadline: string | null;
  /** Whole days until the deadline. The design renders "3 GÜN". */
  days_left: number | null;
  /**
   * Where applying actually happens — the employer's own site.
   *
   * Kiksu does NOT take applications. Vacancies are aggregated and the student
   * is handed off, which means no CV, no career profile, and no real name
   * anywhere in the system. See the note on Layer 4 in the brief.
   */
  external_url: string | null;
  employer: { slug: string; name: string; logo_initials: string | null; brand_color: string | null };
}


export interface CategoryDto {
  id: string;
  key: string;
  name: string;
}

export interface CreateListingInput {
  categoryKey: string;
  title: string;
  description?: string;
  /** Minor units. The client converts manat to qəpik before sending. */
  priceMinor: number;
  isNegotiable: boolean;
  condition: string;
  meetupNotes: string[];
  relatedCourseId?: string;
}
