export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      absence: {
        Row: {
          created_at: string
          enrollment_id: string
          excuse_note: string | null
          excuse_state: string | null
          id: string
          kind: Database["public"]["Enums"]["absence_kind"]
          meeting_id: string | null
          occurred_on: string
          source: Database["public"]["Enums"]["absence_source"]
        }
        Insert: {
          created_at?: string
          enrollment_id: string
          excuse_note?: string | null
          excuse_state?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["absence_kind"]
          meeting_id?: string | null
          occurred_on: string
          source?: Database["public"]["Enums"]["absence_source"]
        }
        Update: {
          created_at?: string
          enrollment_id?: string
          excuse_note?: string | null
          excuse_state?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["absence_kind"]
          meeting_id?: string | null
          occurred_on?: string
          source?: Database["public"]["Enums"]["absence_source"]
        }
        Relationships: [
          {
            foreignKeyName: "absence_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollment"
            referencedColumns: ["id"]
          },
        ]
      }
      app_user: {
        Row: {
          auth_user_id: string
          avatar_id: number | null
          card_review_state:
            | "none"
            | "pending"
            | "in_review"
            | "verified"
            | "rejected"
            | "expired"
            | "revoked"
          comment_count: number
          complaint_count: number
          contributor_level: number
          contributor_level_at: string | null
          created_at: string
          deactivated_at: string | null
          deal_count: number
          display_cohort_size: number | null
          display_faculty_id: string | null
          display_study_year: number | null
          feed_languages: Database["public"]["Enums"]["locale_code"][]
          handle: string
          handle_change_allowed_at: string
          handle_changed_at: string
          handle_folded: string | null
          handle_number: number | null
          id: string
          karma: number
          last_active_at: string | null
          locale: Database["public"]["Enums"]["locale_code"]
          post_count: number
          privacy_discoverable: boolean
          privacy_link_listings: boolean
          privacy_share_timetable: boolean
          privacy_show_uni_badge: boolean
          privacy_show_year: boolean
          projection_updated_at: string | null
          response_rate_pct: number | null
          response_time_median_sec: number | null
          review_count: number
          status: Database["public"]["Enums"]["app_user_status"]
          suspended_until: string | null
          trade_rating_avg: number | null
          trade_rating_count: number
          trade_rating_sum: number
          university_id: string | null
          updated_at: string
          verification_tier: Database["public"]["Enums"]["verification_tier"]
        }
        Insert: {
          auth_user_id: string
          avatar_id?: number | null
          card_review_state?:
            | "none"
            | "pending"
            | "in_review"
            | "verified"
            | "rejected"
            | "expired"
            | "revoked"
          comment_count?: number
          complaint_count?: number
          contributor_level?: number
          contributor_level_at?: string | null
          created_at?: string
          deactivated_at?: string | null
          deal_count?: number
          display_cohort_size?: number | null
          display_faculty_id?: string | null
          display_study_year?: number | null
          feed_languages?: Database["public"]["Enums"]["locale_code"][]
          handle: string
          handle_change_allowed_at?: string
          handle_changed_at?: string
          handle_folded?: string | null
          handle_number?: number | null
          id?: string
          karma?: number
          last_active_at?: string | null
          locale?: Database["public"]["Enums"]["locale_code"]
          post_count?: number
          privacy_discoverable?: boolean
          privacy_link_listings?: boolean
          privacy_share_timetable?: boolean
          privacy_show_uni_badge?: boolean
          privacy_show_year?: boolean
          projection_updated_at?: string | null
          response_rate_pct?: number | null
          response_time_median_sec?: number | null
          review_count?: number
          status?: Database["public"]["Enums"]["app_user_status"]
          suspended_until?: string | null
          trade_rating_avg?: number | null
          trade_rating_count?: number
          trade_rating_sum?: number
          university_id?: string | null
          updated_at?: string
          verification_tier?: Database["public"]["Enums"]["verification_tier"]
        }
        Update: {
          auth_user_id?: string
          avatar_id?: number | null
          card_review_state?:
            | "none"
            | "pending"
            | "in_review"
            | "verified"
            | "rejected"
            | "expired"
            | "revoked"
          comment_count?: number
          complaint_count?: number
          contributor_level?: number
          contributor_level_at?: string | null
          created_at?: string
          deactivated_at?: string | null
          deal_count?: number
          display_cohort_size?: number | null
          display_faculty_id?: string | null
          display_study_year?: number | null
          feed_languages?: Database["public"]["Enums"]["locale_code"][]
          handle?: string
          handle_change_allowed_at?: string
          handle_changed_at?: string
          handle_folded?: string | null
          handle_number?: number | null
          id?: string
          karma?: number
          last_active_at?: string | null
          locale?: Database["public"]["Enums"]["locale_code"]
          post_count?: number
          privacy_discoverable?: boolean
          privacy_link_listings?: boolean
          privacy_share_timetable?: boolean
          privacy_show_uni_badge?: boolean
          privacy_show_year?: boolean
          projection_updated_at?: string | null
          response_rate_pct?: number | null
          response_time_median_sec?: number | null
          review_count?: number
          status?: Database["public"]["Enums"]["app_user_status"]
          suspended_until?: string | null
          trade_rating_avg?: number | null
          trade_rating_count?: number
          trade_rating_sum?: number
          university_id?: string | null
          updated_at?: string
          verification_tier?: Database["public"]["Enums"]["verification_tier"]
        }
        Relationships: []
      }
      board: {
        Row: {
          allows_image: boolean
          allows_poll: boolean
          club_id: string | null
          course_id: string | null
          created_at: string
          description_az: string | null
          display_order: number
          faculty_id: string | null
          follower_count: number
          id: string
          is_archived: boolean
          is_default_follow: boolean
          lang: Database["public"]["Enums"]["locale_code"]
          last_post_at: string | null
          min_tier_to_post: Database["public"]["Enums"]["verification_tier"]
          min_tier_to_read: Database["public"]["Enums"]["verification_tier"]
          name_az: string
          name_en: string | null
          name_ru: string | null
          post_count: number
          scope: Database["public"]["Enums"]["board_scope"]
          slug: string
          university_id: string | null
          updated_at: string
        }
        Insert: {
          allows_image?: boolean
          allows_poll?: boolean
          club_id?: string | null
          course_id?: string | null
          created_at?: string
          description_az?: string | null
          display_order?: number
          faculty_id?: string | null
          follower_count?: number
          id?: string
          is_archived?: boolean
          is_default_follow?: boolean
          lang?: Database["public"]["Enums"]["locale_code"]
          last_post_at?: string | null
          min_tier_to_post?: Database["public"]["Enums"]["verification_tier"]
          min_tier_to_read?: Database["public"]["Enums"]["verification_tier"]
          name_az: string
          name_en?: string | null
          name_ru?: string | null
          post_count?: number
          scope?: Database["public"]["Enums"]["board_scope"]
          slug: string
          university_id?: string | null
          updated_at?: string
        }
        Update: {
          allows_image?: boolean
          allows_poll?: boolean
          club_id?: string | null
          course_id?: string | null
          created_at?: string
          description_az?: string | null
          display_order?: number
          faculty_id?: string | null
          follower_count?: number
          id?: string
          is_archived?: boolean
          is_default_follow?: boolean
          lang?: Database["public"]["Enums"]["locale_code"]
          last_post_at?: string | null
          min_tier_to_post?: Database["public"]["Enums"]["verification_tier"]
          min_tier_to_read?: Database["public"]["Enums"]["verification_tier"]
          name_az?: string
          name_en?: string | null
          name_ru?: string | null
          post_count?: number
          scope?: Database["public"]["Enums"]["board_scope"]
          slug?: string
          university_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_club_fk"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "club"
            referencedColumns: ["id"]
          },
        ]
      }
      board_follow: {
        Row: {
          app_user_id: string
          board_id: string
          followed_at: string
          is_muted: boolean
        }
        Insert: {
          app_user_id: string
          board_id: string
          followed_at?: string
          is_muted?: boolean
        }
        Update: {
          app_user_id?: string
          board_id?: string
          followed_at?: string
          is_muted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "board_follow_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_follow_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_follow_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_follow_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board"
            referencedColumns: ["id"]
          },
        ]
      }
      campus_event: {
        Row: {
          address: string | null
          attendee_count: number
          capacity: number | null
          club_id: string | null
          cover_storage_path: string | null
          created_at: string
          created_by: string | null
          description: string | null
          employer_id: string | null
          ends_at: string | null
          id: string
          is_online: boolean
          join_url: string | null
          kind: Database["public"]["Enums"]["event_kind"]
          lang: Database["public"]["Enums"]["locale_code"]
          moderation_state: Database["public"]["Enums"]["moderation_state"]
          published_at: string | null
          room_id: string | null
          starts_at: string
          title: string
          university_id: string | null
          venue_name: string | null
        }
        Insert: {
          address?: string | null
          attendee_count?: number
          capacity?: number | null
          club_id?: string | null
          cover_storage_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          employer_id?: string | null
          ends_at?: string | null
          id?: string
          is_online?: boolean
          join_url?: string | null
          kind?: Database["public"]["Enums"]["event_kind"]
          lang?: Database["public"]["Enums"]["locale_code"]
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          published_at?: string | null
          room_id?: string | null
          starts_at: string
          title: string
          university_id?: string | null
          venue_name?: string | null
        }
        Update: {
          address?: string | null
          attendee_count?: number
          capacity?: number | null
          club_id?: string | null
          cover_storage_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          employer_id?: string | null
          ends_at?: string | null
          id?: string
          is_online?: boolean
          join_url?: string | null
          kind?: Database["public"]["Enums"]["event_kind"]
          lang?: Database["public"]["Enums"]["locale_code"]
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          published_at?: string | null
          room_id?: string | null
          starts_at?: string
          title?: string
          university_id?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campus_event_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "club"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_event_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_event_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_event_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campus_event_employer_id_fkey"
            columns: ["employer_id"]
            isOneToOne: false
            referencedRelation: "employer"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          kind: Database["public"]["Enums"]["chat_message_kind"]
          moderation_state: Database["public"]["Enums"]["moderation_state"]
          offer_price_minor: number | null
          sender_id: string
          storage_path: string | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["chat_message_kind"]
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          offer_price_minor?: number | null
          sender_id: string
          storage_path?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["chat_message_kind"]
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          offer_price_minor?: number | null
          sender_id?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      club: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_verified: boolean
          logo_storage_path: string | null
          member_count: number
          name: string
          owner_id: string | null
          slug: string
          university_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          logo_storage_path?: string | null
          member_count?: number
          name: string
          owner_id?: string | null
          slug: string
          university_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          logo_storage_path?: string | null
          member_count?: number
          name?: string
          owner_id?: string | null
          slug?: string
          university_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      club_member: {
        Row: {
          app_user_id: string
          club_id: string
          joined_at: string
          left_at: string | null
          role: Database["public"]["Enums"]["club_member_role"]
        }
        Insert: {
          app_user_id: string
          club_id: string
          joined_at?: string
          left_at?: string | null
          role?: Database["public"]["Enums"]["club_member_role"]
        }
        Update: {
          app_user_id?: string
          club_id?: string
          joined_at?: string
          left_at?: string | null
          role?: Database["public"]["Enums"]["club_member_role"]
        }
        Relationships: [
          {
            foreignKeyName: "club_member_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_member_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_member_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_member_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "club"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_size: {
        Row: {
          computed_at: string
          faculty_id: string | null
          program_id: string | null
          study_year: number | null
          university_id: string
          verified_count: number
        }
        Insert: {
          computed_at?: string
          faculty_id?: string | null
          program_id?: string | null
          study_year?: number | null
          university_id: string
          verified_count: number
        }
        Update: {
          computed_at?: string
          faculty_id?: string | null
          program_id?: string | null
          study_year?: number | null
          university_id?: string
          verified_count?: number
        }
        Relationships: []
      }
      comment_vote: {
        Row: {
          app_user_id: string
          comment_id: string
          created_at: string
          value: number
        }
        Insert: {
          app_user_id: string
          comment_id: string
          created_at?: string
          value: number
        }
        Update: {
          app_user_id?: string
          comment_id?: string
          created_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "comment_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_vote_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comment"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation: {
        Row: {
          created_at: string
          created_by: string
          deal_id: string | null
          id: string
          is_closed: boolean
          kind: Database["public"]["Enums"]["conversation_kind"]
          last_message_at: string | null
          listing_id: string | null
          message_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          deal_id?: string | null
          id?: string
          is_closed?: boolean
          kind?: Database["public"]["Enums"]["conversation_kind"]
          last_message_at?: string | null
          listing_id?: string | null
          message_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          deal_id?: string | null
          id?: string
          is_closed?: boolean
          kind?: Database["public"]["Enums"]["conversation_kind"]
          last_message_at?: string | null
          listing_id?: string | null
          message_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listing"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participant: {
        Row: {
          app_user_id: string
          conversation_id: string
          is_muted: boolean
          joined_at: string
          last_read_at: string | null
          left_at: string | null
          role: string
          unread_count: number
        }
        Insert: {
          app_user_id: string
          conversation_id: string
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          role?: string
          unread_count?: number
        }
        Update: {
          app_user_id?: string
          conversation_id?: string
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          role?: string
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participant_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participant_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participant_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participant_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
        ]
      }
      course_instructor_review_summary: {
        Row: {
          attendance_sum: number
          course_id: string
          fairness_sum: number
          instructor_id: string
          quality_sum: number
          rating_avg: number | null
          rating_sum: number
          review_count: number
          updated_at: string
          workload_sum: number
        }
        Insert: {
          attendance_sum?: number
          course_id: string
          fairness_sum?: number
          instructor_id: string
          quality_sum?: number
          rating_avg?: number | null
          rating_sum?: number
          review_count?: number
          updated_at?: string
          workload_sum?: number
        }
        Update: {
          attendance_sum?: number
          course_id?: string
          fairness_sum?: number
          instructor_id?: string
          quality_sum?: number
          rating_avg?: number | null
          rating_sum?: number
          review_count?: number
          updated_at?: string
          workload_sum?: number
        }
        Relationships: []
      }
      course_material: {
        Row: {
          byte_size: number | null
          copyright_flagged: boolean
          course_id: string
          created_at: string
          deleted_at: string | null
          download_count: number
          id: string
          kind: string
          mime_type: string | null
          moderation_state: Database["public"]["Enums"]["moderation_state"]
          section_id: string | null
          storage_path: string
          title: string
          uploader_id: string | null
        }
        Insert: {
          byte_size?: number | null
          copyright_flagged?: boolean
          course_id: string
          created_at?: string
          deleted_at?: string | null
          download_count?: number
          id?: string
          kind?: string
          mime_type?: string | null
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          section_id?: string | null
          storage_path: string
          title: string
          uploader_id?: string | null
        }
        Update: {
          byte_size?: number | null
          copyright_flagged?: boolean
          course_id?: string
          created_at?: string
          deleted_at?: string | null
          download_count?: number
          id?: string
          kind?: string
          mime_type?: string | null
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          section_id?: string | null
          storage_path?: string
          title?: string
          uploader_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_material_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_material_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_material_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_review_summary: {
        Row: {
          attendance_sum: number
          course_id: string
          fairness_sum: number
          quality_sum: number
          rating_avg: number | null
          rating_sum: number
          review_count: number
          top_tags: Json
          updated_at: string
          workload_sum: number
        }
        Insert: {
          attendance_sum?: number
          course_id: string
          fairness_sum?: number
          quality_sum?: number
          rating_avg?: number | null
          rating_sum?: number
          review_count?: number
          top_tags?: Json
          updated_at?: string
          workload_sum?: number
        }
        Update: {
          attendance_sum?: number
          course_id?: string
          fairness_sum?: number
          quality_sum?: number
          rating_avg?: number | null
          rating_sum?: number
          review_count?: number
          top_tags?: Json
          updated_at?: string
          workload_sum?: number
        }
        Relationships: []
      }
      coursework: {
        Row: {
          confirm_count: number
          created_at: string
          created_by: string | null
          description: string | null
          dispute_count: number
          due_at: string | null
          id: string
          is_verified: boolean
          kind: Database["public"]["Enums"]["coursework_kind"]
          origin: Database["public"]["Enums"]["coursework_origin"]
          section_id: string
          title: string
          updated_at: string
          weight_pct: number | null
        }
        Insert: {
          confirm_count?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispute_count?: number
          due_at?: string | null
          id?: string
          is_verified?: boolean
          kind?: Database["public"]["Enums"]["coursework_kind"]
          origin?: Database["public"]["Enums"]["coursework_origin"]
          section_id: string
          title: string
          updated_at?: string
          weight_pct?: number | null
        }
        Update: {
          confirm_count?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispute_count?: number
          due_at?: string | null
          id?: string
          is_verified?: boolean
          kind?: Database["public"]["Enums"]["coursework_kind"]
          origin?: Database["public"]["Enums"]["coursework_origin"]
          section_id?: string
          title?: string
          updated_at?: string
          weight_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coursework_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coursework_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coursework_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coursework_state: {
        Row: {
          app_user_id: string
          coursework_id: string
          remind_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          app_user_id: string
          coursework_id: string
          remind_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          app_user_id?: string
          coursework_id?: string
          remind_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coursework_state_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coursework_state_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coursework_state_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coursework_state_coursework_id_fkey"
            columns: ["coursework_id"]
            isOneToOne: false
            referencedRelation: "coursework"
            referencedColumns: ["id"]
          },
        ]
      }
      deal: {
        Row: {
          agreed_at: string | null
          agreed_price_minor: number | null
          buyer_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          currency: string
          id: string
          listing_id: string
          seller_id: string
          state: Database["public"]["Enums"]["deal_state"]
          updated_at: string
        }
        Insert: {
          agreed_at?: string | null
          agreed_price_minor?: number | null
          buyer_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          listing_id: string
          seller_id: string
          state?: Database["public"]["Enums"]["deal_state"]
          updated_at?: string
        }
        Update: {
          agreed_at?: string | null
          agreed_price_minor?: number | null
          buyer_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          listing_id?: string
          seller_id?: string
          state?: Database["public"]["Enums"]["deal_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_token: {
        Row: {
          app_user_id: string
          id: string
          last_seen_at: string
          locale: Database["public"]["Enums"]["locale_code"]
          platform: string
          push_token: string
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          revoked_at: string | null
        }
        Insert: {
          app_user_id: string
          id?: string
          last_seen_at?: string
          locale?: Database["public"]["Enums"]["locale_code"]
          platform: string
          push_token: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          revoked_at?: string | null
        }
        Update: {
          app_user_id?: string
          id?: string
          last_seen_at?: string
          locale?: Database["public"]["Enums"]["locale_code"]
          platform?: string
          push_token?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_token_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_token_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_token_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employer: {
        Row: {
          brand_color: string | null
          city: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_verified: boolean
          logo_initials: string | null
          logo_storage_path: string | null
          name: string
          name_folded: string | null
          sector_id: string | null
          slug: string
          updated_at: string
          website: string | null
        }
        Insert: {
          brand_color?: string | null
          city?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          logo_initials?: string | null
          logo_storage_path?: string | null
          name: string
          name_folded?: string | null
          sector_id?: string | null
          slug: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          brand_color?: string | null
          city?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          logo_initials?: string | null
          logo_storage_path?: string | null
          name?: string
          name_folded?: string | null
          sector_id?: string | null
          slug?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      employer_recruiter: {
        Row: {
          auth_user_id: string
          created_at: string
          employer_id: string
          full_name: string
          id: string
          is_active: boolean
          job_title: string | null
          role: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          employer_id: string
          full_name: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          role?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          employer_id?: string
          full_name?: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_recruiter_employer_id_fkey"
            columns: ["employer_id"]
            isOneToOne: false
            referencedRelation: "employer"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment: {
        Row: {
          absence_count: number
          absence_limit: number | null
          absence_notified_at: string | null
          absence_units: number
          app_user_id: string
          color: Database["public"]["Enums"]["accent_color"]
          created_at: string
          display_order: number | null
          final_letter: string | null
          final_score: number | null
          gpa_points: number | null
          id: string
          section_id: string
          state: Database["public"]["Enums"]["enrollment_state"]
          term_id: string
          updated_at: string
        }
        Insert: {
          absence_count?: number
          absence_limit?: number | null
          absence_notified_at?: string | null
          absence_units?: number
          app_user_id: string
          color?: Database["public"]["Enums"]["accent_color"]
          created_at?: string
          display_order?: number | null
          final_letter?: string | null
          final_score?: number | null
          gpa_points?: number | null
          id?: string
          section_id: string
          state?: Database["public"]["Enums"]["enrollment_state"]
          term_id: string
          updated_at?: string
        }
        Update: {
          absence_count?: number
          absence_limit?: number | null
          absence_notified_at?: string | null
          absence_units?: number
          app_user_id?: string
          color?: Database["public"]["Enums"]["accent_color"]
          created_at?: string
          display_order?: number | null
          final_letter?: string | null
          final_score?: number | null
          gpa_points?: number | null
          id?: string
          section_id?: string
          state?: Database["public"]["Enums"]["enrollment_state"]
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvp: {
        Row: {
          app_user_id: string
          created_at: string
          event_id: string
          state: Database["public"]["Enums"]["rsvp_state"]
        }
        Insert: {
          app_user_id: string
          created_at?: string
          event_id: string
          state?: Database["public"]["Enums"]["rsvp_state"]
        }
        Update: {
          app_user_id?: string
          created_at?: string
          event_id?: string
          state?: Database["public"]["Enums"]["rsvp_state"]
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvp_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvp_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvp_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvp_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campus_event"
            referencedColumns: ["id"]
          },
        ]
      }
      instructor_review_summary: {
        Row: {
          attendance_avg: number | null
          attendance_sum: number
          course_count: number
          fairness_avg: number | null
          fairness_sum: number
          instructor_id: string
          quality_avg: number | null
          quality_sum: number
          rating_avg: number | null
          rating_sum: number
          review_count: number
          star_1: number
          star_2: number
          star_3: number
          star_4: number
          star_5: number
          top_tags: Json
          updated_at: string
          workload_avg: number | null
          workload_sum: number
        }
        Insert: {
          attendance_avg?: number | null
          attendance_sum?: number
          course_count?: number
          fairness_avg?: number | null
          fairness_sum?: number
          instructor_id: string
          quality_avg?: number | null
          quality_sum?: number
          rating_avg?: number | null
          rating_sum?: number
          review_count?: number
          star_1?: number
          star_2?: number
          star_3?: number
          star_4?: number
          star_5?: number
          top_tags?: Json
          updated_at?: string
          workload_avg?: number | null
          workload_sum?: number
        }
        Update: {
          attendance_avg?: number | null
          attendance_sum?: number
          course_count?: number
          fairness_avg?: number | null
          fairness_sum?: number
          instructor_id?: string
          quality_avg?: number | null
          quality_sum?: number
          rating_avg?: number | null
          rating_sum?: number
          review_count?: number
          star_1?: number
          star_2?: number
          star_3?: number
          star_4?: number
          star_5?: number
          top_tags?: Json
          updated_at?: string
          workload_avg?: number | null
          workload_sum?: number
        }
        Relationships: []
      }
      listing: {
        Row: {
          attributes: Json
          bumped_at: string
          category_id: string
          chat_count: number
          condition: Database["public"]["Enums"]["listing_condition"]
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          expires_at: string | null
          id: string
          image_count: number
          is_negotiable: boolean
          lang: Database["public"]["Enums"]["locale_code"]
          meetup_notes: string[]
          moderation_state: Database["public"]["Enums"]["moderation_state"]
          price_minor: number
          published_at: string
          related_course_id: string | null
          report_count: number
          save_count: number
          search_vector: unknown
          seller_id: string
          sold_at: string | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          university_id: string
          updated_at: string
          view_count: number
        }
        Insert: {
          attributes?: Json
          bumped_at?: string
          category_id: string
          chat_count?: number
          condition?: Database["public"]["Enums"]["listing_condition"]
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_count?: number
          is_negotiable?: boolean
          lang?: Database["public"]["Enums"]["locale_code"]
          meetup_notes?: string[]
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          price_minor: number
          published_at?: string
          related_course_id?: string | null
          report_count?: number
          save_count?: number
          search_vector?: unknown
          seller_id: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          university_id: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          attributes?: Json
          bumped_at?: string
          category_id?: string
          chat_count?: number
          condition?: Database["public"]["Enums"]["listing_condition"]
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_count?: number
          is_negotiable?: boolean
          lang?: Database["public"]["Enums"]["locale_code"]
          meetup_notes?: string[]
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          price_minor?: number
          published_at?: string
          related_course_id?: string | null
          report_count?: number
          save_count?: number
          search_vector?: unknown
          seller_id?: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          university_id?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "listing_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_image: {
        Row: {
          blurhash: string | null
          byte_size: number | null
          exif_stripped: boolean
          height: number | null
          id: string
          listing_id: string
          position: number
          storage_path: string
          width: number | null
        }
        Insert: {
          blurhash?: string | null
          byte_size?: number | null
          exif_stripped?: boolean
          height?: number | null
          id?: string
          listing_id: string
          position?: number
          storage_path: string
          width?: number | null
        }
        Update: {
          blurhash?: string | null
          byte_size?: number | null
          exif_stripped?: boolean
          height?: number | null
          id?: string
          listing_id?: string
          position?: number
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_image_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listing"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_save: {
        Row: {
          app_user_id: string
          created_at: string
          listing_id: string
        }
        Insert: {
          app_user_id: string
          created_at?: string
          listing_id: string
        }
        Update: {
          app_user_id?: string
          created_at?: string
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_save_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listing"
            referencedColumns: ["id"]
          },
        ]
      }
      notification: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          group_key: string | null
          id: string
          is_read: boolean
          kind_key: string
          payload: Json
          read_at: string | null
          recipient_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          group_key?: string | null
          id?: string
          is_read?: boolean
          kind_key: string
          payload?: Json
          read_at?: string | null
          recipient_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          group_key?: string | null
          id?: string
          is_read?: boolean
          kind_key?: string
          payload?: Json
          read_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preference: {
        Row: {
          app_user_id: string
          email_enabled: boolean
          kind_key: string
          push_enabled: boolean
        }
        Insert: {
          app_user_id: string
          email_enabled?: boolean
          kind_key: string
          push_enabled?: boolean
        }
        Update: {
          app_user_id?: string
          email_enabled?: boolean
          kind_key?: string
          push_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_preference_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preference_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preference_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      poll: {
        Row: {
          closes_at: string | null
          created_at: string
          hide_results_until_vote: boolean
          is_multi_choice: boolean
          max_choices: number
          post_id: string
          question: string | null
          total_votes: number
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          hide_results_until_vote?: boolean
          is_multi_choice?: boolean
          max_choices?: number
          post_id: string
          question?: string | null
          total_votes?: number
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          hide_results_until_vote?: boolean
          is_multi_choice?: boolean
          max_choices?: number
          post_id?: string
          question?: string | null
          total_votes?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "post"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_option: {
        Row: {
          id: string
          label: string
          position: number
          post_id: string
          vote_count: number
        }
        Insert: {
          id?: string
          label: string
          position: number
          post_id: string
          vote_count?: number
        }
        Update: {
          id?: string
          label?: string
          position?: number
          post_id?: string
          vote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_option_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "poll"
            referencedColumns: ["post_id"]
          },
        ]
      }
      poll_vote: {
        Row: {
          app_user_id: string
          created_at: string
          option_id: string
          post_id: string
        }
        Insert: {
          app_user_id: string
          created_at?: string
          option_id: string
          post_id: string
        }
        Update: {
          app_user_id?: string
          created_at?: string
          option_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_vote_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_option"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_vote_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "poll"
            referencedColumns: ["post_id"]
          },
        ]
      }
      post: {
        Row: {
          alias_high_water: number
          attachment_count: number
          author_alias_number: number | null
          author_app_user_id: string | null
          author_display_mode: Database["public"]["Enums"]["author_display_mode"]
          author_tier: Database["public"]["Enums"]["verification_tier"]
          board_id: string
          body: string | null
          comment_count: number
          created_at: string
          deleted_at: string | null
          downvote_count: number
          edited_at: string | null
          has_poll: boolean
          hot_rank: number
          id: string
          is_locked: boolean
          is_pinned: boolean
          kind: Database["public"]["Enums"]["post_kind"]
          lang: Database["public"]["Enums"]["locale_code"]
          last_comment_at: string | null
          moderation_state: Database["public"]["Enums"]["moderation_state"]
          report_count: number
          save_count: number
          score: number
          search_vector: unknown
          title: string
          university_id: string | null
          upvote_count: number
          view_count: number
        }
        Insert: {
          alias_high_water?: number
          attachment_count?: number
          author_alias_number?: number | null
          author_app_user_id?: string | null
          author_display_mode?: Database["public"]["Enums"]["author_display_mode"]
          author_tier?: Database["public"]["Enums"]["verification_tier"]
          board_id: string
          body?: string | null
          comment_count?: number
          created_at?: string
          deleted_at?: string | null
          downvote_count?: number
          edited_at?: string | null
          has_poll?: boolean
          hot_rank?: number
          id?: string
          is_locked?: boolean
          is_pinned?: boolean
          kind?: Database["public"]["Enums"]["post_kind"]
          lang?: Database["public"]["Enums"]["locale_code"]
          last_comment_at?: string | null
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          report_count?: number
          save_count?: number
          score?: number
          search_vector?: unknown
          title: string
          university_id?: string | null
          upvote_count?: number
          view_count?: number
        }
        Update: {
          alias_high_water?: number
          attachment_count?: number
          author_alias_number?: number | null
          author_app_user_id?: string | null
          author_display_mode?: Database["public"]["Enums"]["author_display_mode"]
          author_tier?: Database["public"]["Enums"]["verification_tier"]
          board_id?: string
          body?: string | null
          comment_count?: number
          created_at?: string
          deleted_at?: string | null
          downvote_count?: number
          edited_at?: string | null
          has_poll?: boolean
          hot_rank?: number
          id?: string
          is_locked?: boolean
          is_pinned?: boolean
          kind?: Database["public"]["Enums"]["post_kind"]
          lang?: Database["public"]["Enums"]["locale_code"]
          last_comment_at?: string | null
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          report_count?: number
          save_count?: number
          score?: number
          search_vector?: unknown
          title?: string
          university_id?: string | null
          upvote_count?: number
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_author_app_user_id_fkey"
            columns: ["author_app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_author_app_user_id_fkey"
            columns: ["author_app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_author_app_user_id_fkey"
            columns: ["author_app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board"
            referencedColumns: ["id"]
          },
        ]
      }
      post_attachment: {
        Row: {
          blurhash: string | null
          byte_size: number | null
          created_at: string
          exif_stripped: boolean
          height: number | null
          id: string
          mime_type: string | null
          position: number
          post_id: string
          storage_path: string
          width: number | null
        }
        Insert: {
          blurhash?: string | null
          byte_size?: number | null
          created_at?: string
          exif_stripped?: boolean
          height?: number | null
          id?: string
          mime_type?: string | null
          position?: number
          post_id: string
          storage_path: string
          width?: number | null
        }
        Update: {
          blurhash?: string | null
          byte_size?: number | null
          created_at?: string
          exif_stripped?: boolean
          height?: number | null
          id?: string
          mime_type?: string | null
          position?: number
          post_id?: string
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_attachment_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "post"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comment: {
        Row: {
          author_alias_number: number | null
          author_app_user_id: string | null
          author_display_mode: Database["public"]["Enums"]["author_display_mode"]
          author_tier: Database["public"]["Enums"]["verification_tier"]
          body: string
          created_at: string
          deleted_at: string | null
          depth: number
          downvote_count: number
          edited_at: string | null
          id: string
          is_op: boolean
          moderation_state: Database["public"]["Enums"]["moderation_state"]
          parent_id: string | null
          path: number[]
          post_id: string
          reply_count: number
          report_count: number
          score: number
          seq_in_post: number
          upvote_count: number
        }
        Insert: {
          author_alias_number?: number | null
          author_app_user_id?: string | null
          author_display_mode?: Database["public"]["Enums"]["author_display_mode"]
          author_tier?: Database["public"]["Enums"]["verification_tier"]
          body: string
          created_at?: string
          deleted_at?: string | null
          depth?: number
          downvote_count?: number
          edited_at?: string | null
          id?: string
          is_op?: boolean
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          parent_id?: string | null
          path: number[]
          post_id: string
          reply_count?: number
          report_count?: number
          score?: number
          seq_in_post: number
          upvote_count?: number
        }
        Update: {
          author_alias_number?: number | null
          author_app_user_id?: string | null
          author_display_mode?: Database["public"]["Enums"]["author_display_mode"]
          author_tier?: Database["public"]["Enums"]["verification_tier"]
          body?: string
          created_at?: string
          deleted_at?: string | null
          depth?: number
          downvote_count?: number
          edited_at?: string | null
          id?: string
          is_op?: boolean
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          parent_id?: string | null
          path?: number[]
          post_id?: string
          reply_count?: number
          report_count?: number
          score?: number
          seq_in_post?: number
          upvote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_comment_author_app_user_id_fkey"
            columns: ["author_app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comment_author_app_user_id_fkey"
            columns: ["author_app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comment_author_app_user_id_fkey"
            columns: ["author_app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comment_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "post_comment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comment_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "post"
            referencedColumns: ["id"]
          },
        ]
      }
      post_save: {
        Row: {
          app_user_id: string
          created_at: string
          post_id: string
        }
        Insert: {
          app_user_id: string
          created_at?: string
          post_id: string
        }
        Update: {
          app_user_id?: string
          created_at?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_save_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "post"
            referencedColumns: ["id"]
          },
        ]
      }
      post_vote: {
        Row: {
          app_user_id: string
          created_at: string
          post_id: string
          value: number
        }
        Insert: {
          app_user_id: string
          created_at?: string
          post_id: string
          value: number
        }
        Update: {
          app_user_id?: string
          created_at?: string
          post_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_vote_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_vote_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "post"
            referencedColumns: ["id"]
          },
        ]
      }
      report: {
        Row: {
          case_id: string | null
          created_at: string
          details: string | null
          id: string
          reason_key: string
          reporter_id: string
          state: string
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason_key: string
          reporter_id: string
          state?: string
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
        }
        Update: {
          case_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason_key?: string
          reporter_id?: string
          state?: string
          target_id?: string
          target_type?: Database["public"]["Enums"]["report_target_type"]
        }
        Relationships: [
          {
            foreignKeyName: "report_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      review: {
        Row: {
          attendance_strictness: number
          body: string | null
          course_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          fairness: number
          helpful_count: number
          id: string
          instructor_id: string
          is_enrollment_verified: boolean
          lang: Database["public"]["Enums"]["locale_code"]
          moderation_state: Database["public"]["Enums"]["moderation_state"]
          overall_rating: number
          quality: number
          report_count: number
          search_vector: unknown
          tag_keys: string[]
          term_id: string
          university_id: string
          verified_cohort_size: number | null
          workload: number
        }
        Insert: {
          attendance_strictness: number
          body?: string | null
          course_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          fairness: number
          helpful_count?: number
          id?: string
          instructor_id: string
          is_enrollment_verified?: boolean
          lang?: Database["public"]["Enums"]["locale_code"]
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          overall_rating: number
          quality: number
          report_count?: number
          search_vector?: unknown
          tag_keys?: string[]
          term_id: string
          university_id: string
          verified_cohort_size?: number | null
          workload: number
        }
        Update: {
          attendance_strictness?: number
          body?: string | null
          course_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          fairness?: number
          helpful_count?: number
          id?: string
          instructor_id?: string
          is_enrollment_verified?: boolean
          lang?: Database["public"]["Enums"]["locale_code"]
          moderation_state?: Database["public"]["Enums"]["moderation_state"]
          overall_rating?: number
          quality?: number
          report_count?: number
          search_vector?: unknown
          tag_keys?: string[]
          term_id?: string
          university_id?: string
          verified_cohort_size?: number | null
          workload?: number
        }
        Relationships: []
      }
      review_helpful: {
        Row: {
          app_user_id: string
          created_at: string
          review_id: string
        }
        Insert: {
          app_user_id: string
          created_at?: string
          review_id: string
        }
        Update: {
          app_user_id?: string
          created_at?: string
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_helpful_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_helpful_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_helpful_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_helpful_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "review"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_rating: {
        Row: {
          comment: string | null
          created_at: string
          deal_id: string
          id: string
          ratee_id: string
          rater_id: string
          rater_role: string
          score: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          deal_id: string
          id?: string
          ratee_id: string
          rater_id: string
          rater_role: string
          score: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          ratee_id?: string
          rater_id?: string
          rater_role?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "trade_rating_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_rating_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_rating_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_rating_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_rating_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_rating_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_rating_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_block: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_block_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_block_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_block_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_block_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_block_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_block_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sanction: {
        Row: {
          action_id: string | null
          app_user_id: string
          ends_at: string | null
          id: string
          is_active: boolean
          kind: string
          scope_board_id: string | null
          starts_at: string
        }
        Insert: {
          action_id?: string | null
          app_user_id: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          kind: string
          scope_board_id?: string | null
          starts_at?: string
        }
        Update: {
          action_id?: string | null
          app_user_id?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          scope_board_id?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sanction_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sanction_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sanction_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sanction_scope_board_id_fkey"
            columns: ["scope_board_id"]
            isOneToOne: false
            referencedRelation: "board"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancy: {
        Row: {
          application_count: number
          apply_deadline: string | null
          apply_via: string
          city: string | null
          closed_at: string | null
          conversion_possible: boolean
          currency: string
          description: string | null
          duration_months: number | null
          employer_id: string
          external_url: string | null
          hours_per_week: number | null
          id: string
          is_paid: boolean
          kind: Database["public"]["Enums"]["vacancy_kind"]
          lang: Database["public"]["Enums"]["locale_code"]
          max_study_year: number | null
          min_study_year: number | null
          perks: string[]
          posted_at: string
          posted_by: string | null
          required_skills: string[]
          schedule_friendly: boolean
          search_vector: unknown
          sector_id: string | null
          status: Database["public"]["Enums"]["vacancy_status"]
          stipend_minor: number | null
          target_university_ids: string[]
          title: string
          transport_provided: boolean
          updated_at: string
          view_count: number
          work_mode: Database["public"]["Enums"]["work_mode"]
        }
        Insert: {
          application_count?: number
          apply_deadline?: string | null
          apply_via?: string
          city?: string | null
          closed_at?: string | null
          conversion_possible?: boolean
          currency?: string
          description?: string | null
          duration_months?: number | null
          employer_id: string
          external_url?: string | null
          hours_per_week?: number | null
          id?: string
          is_paid?: boolean
          kind?: Database["public"]["Enums"]["vacancy_kind"]
          lang?: Database["public"]["Enums"]["locale_code"]
          max_study_year?: number | null
          min_study_year?: number | null
          perks?: string[]
          posted_at?: string
          posted_by?: string | null
          required_skills?: string[]
          schedule_friendly?: boolean
          search_vector?: unknown
          sector_id?: string | null
          status?: Database["public"]["Enums"]["vacancy_status"]
          stipend_minor?: number | null
          target_university_ids?: string[]
          title: string
          transport_provided?: boolean
          updated_at?: string
          view_count?: number
          work_mode?: Database["public"]["Enums"]["work_mode"]
        }
        Update: {
          application_count?: number
          apply_deadline?: string | null
          apply_via?: string
          city?: string | null
          closed_at?: string | null
          conversion_possible?: boolean
          currency?: string
          description?: string | null
          duration_months?: number | null
          employer_id?: string
          external_url?: string | null
          hours_per_week?: number | null
          id?: string
          is_paid?: boolean
          kind?: Database["public"]["Enums"]["vacancy_kind"]
          lang?: Database["public"]["Enums"]["locale_code"]
          max_study_year?: number | null
          min_study_year?: number | null
          perks?: string[]
          posted_at?: string
          posted_by?: string | null
          required_skills?: string[]
          schedule_friendly?: boolean
          search_vector?: unknown
          sector_id?: string | null
          status?: Database["public"]["Enums"]["vacancy_status"]
          stipend_minor?: number | null
          target_university_ids?: string[]
          title?: string
          transport_provided?: boolean
          updated_at?: string
          view_count?: number
          work_mode?: Database["public"]["Enums"]["work_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "vacancy_employer_id_fkey"
            columns: ["employer_id"]
            isOneToOne: false
            referencedRelation: "employer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancy_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "employer_recruiter"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancy_save: {
        Row: {
          app_user_id: string
          created_at: string
          vacancy_id: string
        }
        Insert: {
          app_user_id: string
          created_at?: string
          vacancy_id: string
        }
        Update: {
          app_user_id?: string
          created_at?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacancy_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancy_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_card"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancy_save_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancy_save_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancy"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      app_user_card: {
        Row: {
          complaint_count: number | null
          created_at: string | null
          deal_count: number | null
          display_faculty_id: string | null
          display_study_year: number | null
          handle: string | null
          handle_number: number | null
          id: string | null
          karma: number | null
          post_count: number | null
          privacy_link_listings: boolean | null
          response_rate_pct: number | null
          response_time_median_sec: number | null
          status: Database["public"]["Enums"]["app_user_status"] | null
          trade_rating_avg: number | null
          trade_rating_count: number | null
          university_id: string | null
          verification_tier:
            | Database["public"]["Enums"]["verification_tier"]
            | null
        }
        Insert: {
          complaint_count?: number | null
          created_at?: string | null
          deal_count?: number | null
          display_faculty_id?: never
          display_study_year?: never
          handle?: string | null
          handle_number?: number | null
          id?: string | null
          karma?: number | null
          post_count?: number | null
          privacy_link_listings?: boolean | null
          response_rate_pct?: number | null
          response_time_median_sec?: number | null
          status?: Database["public"]["Enums"]["app_user_status"] | null
          trade_rating_avg?: number | null
          trade_rating_count?: number | null
          university_id?: never
          verification_tier?:
            | Database["public"]["Enums"]["verification_tier"]
            | null
        }
        Update: {
          complaint_count?: number | null
          created_at?: string | null
          deal_count?: number | null
          display_faculty_id?: never
          display_study_year?: never
          handle?: string | null
          handle_number?: number | null
          id?: string | null
          karma?: number | null
          post_count?: number | null
          privacy_link_listings?: boolean | null
          response_rate_pct?: number | null
          response_time_median_sec?: number | null
          status?: Database["public"]["Enums"]["app_user_status"] | null
          trade_rating_avg?: number | null
          trade_rating_count?: number | null
          university_id?: never
          verification_tier?:
            | Database["public"]["Enums"]["verification_tier"]
            | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          avatar_id: number | null
          contributor_level: number | null
          handle: string | null
          id: string | null
          university_id: string | null
          verification_status: string | null
        }
        Insert: {
          avatar_id?: number | null
          contributor_level?: number | null
          handle?: string | null
          id?: string | null
          university_id?: never
          verification_status?: never
        }
        Update: {
          avatar_id?: number | null
          contributor_level?: number | null
          handle?: string | null
          id?: string | null
          university_id?: never
          verification_status?: never
        }
        Relationships: []
      }
    }
    Functions: {
      can_read_board: { Args: { p_board_id: string }; Returns: boolean }
      contributor_level_for: { Args: { p_karma: number }; Returns: number }
      current_app_user_id: { Args: never; Returns: string }
      current_tier: {
        Args: never
        Returns: Database["public"]["Enums"]["verification_tier"]
      }
      current_university_id: { Args: never; Returns: string }
      fold_karma_ledger: { Args: { p_limit?: number }; Returns: number }
      is_conversation_participant: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      is_enrolled_in_section: {
        Args: { p_section_id: string }
        Returns: boolean
      }
      recompute_seller_stats: { Args: { p_window?: string }; Returns: number }
      refresh_absence_limits: { Args: never; Returns: number }
      refresh_complaint_counts: { Args: never; Returns: number }
      refresh_contributor_levels: { Args: never; Returns: number }
      refresh_view_counts: { Args: never; Returns: number }
    }
    Enums: {
      absence_kind: "absent" | "late" | "excused"
      absence_source: "self_reported" | "instructor" | "import"
      accent_color:
        | "turquoise"
        | "bronze"
        | "pomegranate"
        | "indigo"
        | "ink"
        | "moss"
        | "plum"
      alias_state: "reserved" | "active"
      app_user_status:
        | "pending"
        | "active"
        | "muted"
        | "suspended"
        | "shadowbanned"
        | "deactivated"
        | "erased"
      author_display_mode: "alias" | "handle" | "staff"
      board_scope: "national" | "university" | "faculty" | "course" | "club"
      chat_message_kind: "text" | "image" | "offer" | "system"
      club_member_role: "owner" | "admin" | "member"
      conversation_kind: "listing" | "direct"
      coursework_kind:
        | "homework"
        | "lab"
        | "project"
        | "quiz"
        | "midterm"
        | "final"
        | "presentation"
        | "other"
      coursework_origin: "official" | "crowdsourced" | "personal"
      deal_state: "inquiry" | "agreed" | "completed" | "cancelled" | "disputed"
      enrollment_state: "enrolled" | "dropped" | "completed" | "failed"
      event_kind: "career" | "academic" | "club" | "social" | "sport" | "other"
      listing_condition: "new" | "like_new" | "good" | "fair" | "poor"
      listing_status:
        | "draft"
        | "active"
        | "reserved"
        | "sold"
        | "expired"
        | "removed"
      locale_code: "az" | "ru" | "en"
      meeting_kind: "lecture" | "seminar" | "lab" | "exam" | "consultation"
      moderation_state: "visible" | "pending_review" | "limited" | "removed"
      post_kind: "text" | "image" | "link" | "poll"
      report_target_type:
        | "post"
        | "comment"
        | "review"
        | "listing"
        | "chat_message"
        | "app_user"
        | "event"
        | "club"
      rsvp_state: "going" | "interested" | "cancelled"
      term_season: "payiz" | "yaz" | "yay"
      vacancy_kind:
        | "internship"
        | "part_time"
        | "full_time"
        | "volunteer"
        | "thesis"
        | "scholarship"
      vacancy_status: "draft" | "active" | "paused" | "closed" | "expired"
      verification_method:
        | "university_email"
        | "student_card"
        | "invite_code"
        | "manual_staff"
      verification_tier: "unverified" | "email_verified" | "card_verified"
      week_parity: "every" | "odd" | "even"
      work_mode: "onsite" | "hybrid" | "remote"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      absence_kind: ["absent", "late", "excused"],
      absence_source: ["self_reported", "instructor", "import"],
      accent_color: [
        "turquoise",
        "bronze",
        "pomegranate",
        "indigo",
        "ink",
        "moss",
        "plum",
      ],
      alias_state: ["reserved", "active"],
      app_user_status: [
        "pending",
        "active",
        "muted",
        "suspended",
        "shadowbanned",
        "deactivated",
        "erased",
      ],
      author_display_mode: ["alias", "handle", "staff"],
      board_scope: ["national", "university", "faculty", "course", "club"],
      chat_message_kind: ["text", "image", "offer", "system"],
      club_member_role: ["owner", "admin", "member"],
      conversation_kind: ["listing", "direct"],
      coursework_kind: [
        "homework",
        "lab",
        "project",
        "quiz",
        "midterm",
        "final",
        "presentation",
        "other",
      ],
      coursework_origin: ["official", "crowdsourced", "personal"],
      deal_state: ["inquiry", "agreed", "completed", "cancelled", "disputed"],
      enrollment_state: ["enrolled", "dropped", "completed", "failed"],
      event_kind: ["career", "academic", "club", "social", "sport", "other"],
      listing_condition: ["new", "like_new", "good", "fair", "poor"],
      listing_status: [
        "draft",
        "active",
        "reserved",
        "sold",
        "expired",
        "removed",
      ],
      locale_code: ["az", "ru", "en"],
      meeting_kind: ["lecture", "seminar", "lab", "exam", "consultation"],
      moderation_state: ["visible", "pending_review", "limited", "removed"],
      post_kind: ["text", "image", "link", "poll"],
      report_target_type: [
        "post",
        "comment",
        "review",
        "listing",
        "chat_message",
        "app_user",
        "event",
        "club",
      ],
      rsvp_state: ["going", "interested", "cancelled"],
      term_season: ["payiz", "yaz", "yay"],
      vacancy_kind: [
        "internship",
        "part_time",
        "full_time",
        "volunteer",
        "thesis",
        "scholarship",
      ],
      vacancy_status: ["draft", "active", "paused", "closed", "expired"],
      verification_method: [
        "university_email",
        "student_card",
        "invite_code",
        "manual_staff",
      ],
      verification_tier: ["unverified", "email_verified", "card_verified"],
      week_parity: ["every", "odd", "even"],
      work_mode: ["onsite", "hybrid", "remote"],
    },
  },
} as const
