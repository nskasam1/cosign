// Hand-authored to match supabase/migrations/20260811000000_cosign_rebuild_phase1.sql.
// No Supabase project is linked yet, so this couldn't be generated via
// `supabase gen types typescript`. Once a project exists and the migration
// is applied, regenerate this file for real and diff against this version.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      schools: {
        Row: {
          id: string
          slug: string
          name: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string | null
          school_id: string | null
          avatar_url: string | null
          one_line_taste_summary: string | null
          created_at: string
        }
        Insert: {
          id: string
          username: string
          display_name?: string | null
          school_id?: string | null
          avatar_url?: string | null
          one_line_taste_summary?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          username?: string
          display_name?: string | null
          school_id?: string | null
          avatar_url?: string | null
          one_line_taste_summary?: string | null
          created_at?: string
        }
        Relationships: []
      }
      shops: {
        Row: {
          id: string
          name: string
          address: string
          lat: number
          lng: number
          school_id: string
          hours_json: Json | null
          price_drip: number | null
          price_latte: number | null
          has_student_discount: boolean
          last_verified_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          address: string
          lat: number
          lng: number
          school_id: string
          hours_json?: Json | null
          price_drip?: number | null
          price_latte?: number | null
          has_student_discount?: boolean
          last_verified_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          address?: string
          lat?: number
          lng?: number
          school_id?: string
          hours_json?: Json | null
          price_drip?: number | null
          price_latte?: number | null
          has_student_discount?: boolean
          last_verified_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      shop_snapshots: {
        Row: {
          id: string
          shop_id: string
          time_bucket: Database["public"]["Enums"]["time_bucket"]
          noise_level: number | null
          crowding: number | null
          camp_ability: boolean | null
          camp_ability_note: string | null
          honest_note: string | null
          recorded_by: string | null
          recorded_at: string
        }
        Insert: {
          id?: string
          shop_id: string
          time_bucket: Database["public"]["Enums"]["time_bucket"]
          noise_level?: number | null
          crowding?: number | null
          camp_ability?: boolean | null
          camp_ability_note?: string | null
          honest_note?: string | null
          recorded_by?: string | null
          recorded_at?: string
        }
        Update: {
          id?: string
          shop_id?: string
          time_bucket?: Database["public"]["Enums"]["time_bucket"]
          noise_level?: number | null
          crowding?: number | null
          camp_ability?: boolean | null
          camp_ability_note?: string | null
          honest_note?: string | null
          recorded_by?: string | null
          recorded_at?: string
        }
        Relationships: []
      }
      shop_amenities: {
        Row: {
          shop_id: string
          outlet_count: number | null
          outlet_location_note: string | null
          seat_count: number | null
          laptop_viable_seats: number | null
          table_size: Database["public"]["Enums"]["table_size"] | null
          wifi_speed_mbps: number | null
          wifi_has_password: boolean | null
          wifi_password_location_note: string | null
          bathroom_access: Database["public"]["Enums"]["bathroom_access"] | null
          has_natural_light: boolean | null
          updated_at: string
        }
        Insert: {
          shop_id: string
          outlet_count?: number | null
          outlet_location_note?: string | null
          seat_count?: number | null
          laptop_viable_seats?: number | null
          table_size?: Database["public"]["Enums"]["table_size"] | null
          wifi_speed_mbps?: number | null
          wifi_has_password?: boolean | null
          wifi_password_location_note?: string | null
          bathroom_access?: Database["public"]["Enums"]["bathroom_access"] | null
          has_natural_light?: boolean | null
          updated_at?: string
        }
        Update: {
          shop_id?: string
          outlet_count?: number | null
          outlet_location_note?: string | null
          seat_count?: number | null
          laptop_viable_seats?: number | null
          table_size?: Database["public"]["Enums"]["table_size"] | null
          wifi_speed_mbps?: number | null
          wifi_has_password?: boolean | null
          wifi_password_location_note?: string | null
          bathroom_access?: Database["public"]["Enums"]["bathroom_access"] | null
          has_natural_light?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      shop_photos: {
        Row: {
          id: string
          shop_id: string
          url: string
          type: Database["public"]["Enums"]["shop_photo_type"]
          uploaded_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          shop_id: string
          url: string
          type: Database["public"]["Enums"]["shop_photo_type"]
          uploaded_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          shop_id?: string
          url?: string
          type?: Database["public"]["Enums"]["shop_photo_type"]
          uploaded_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      shop_intent_tag_votes: {
        Row: {
          shop_id: string
          user_id: string
          intent_tag: Database["public"]["Enums"]["intent_tag"]
          created_at: string
        }
        Insert: {
          shop_id: string
          user_id: string
          intent_tag: Database["public"]["Enums"]["intent_tag"]
          created_at?: string
        }
        Update: {
          shop_id?: string
          user_id?: string
          intent_tag?: Database["public"]["Enums"]["intent_tag"]
          created_at?: string
        }
        Relationships: []
      }
      rankings: {
        Row: {
          id: string
          user_id: string
          shop_a_id: string
          shop_b_id: string
          winner_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          shop_a_id: string
          shop_b_id: string
          winner_id: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          shop_a_id?: string
          shop_b_id?: string
          winner_id?: string
          created_at?: string
        }
        Relationships: []
      }
      friendships: {
        Row: {
          id: string
          user_id: string
          friend_id: string
          status: Database["public"]["Enums"]["friendship_status"]
          created_at: string
          responded_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          friend_id: string
          status?: Database["public"]["Enums"]["friendship_status"]
          created_at?: string
          responded_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          friend_id?: string
          status?: Database["public"]["Enums"]["friendship_status"]
          created_at?: string
          responded_at?: string | null
        }
        Relationships: []
      }
      lists: {
        Row: {
          id: string
          title: string
          owner_id: string
          is_collaborative: boolean
          school_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          owner_id: string
          is_collaborative?: boolean
          school_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          owner_id?: string
          is_collaborative?: boolean
          school_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      list_editors: {
        Row: {
          list_id: string
          user_id: string
          added_at: string
        }
        Insert: {
          list_id: string
          user_id: string
          added_at?: string
        }
        Update: {
          list_id?: string
          user_id?: string
          added_at?: string
        }
        Relationships: []
      }
      list_items: {
        Row: {
          id: string
          list_id: string
          shop_id: string
          added_by: string
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          list_id: string
          shop_id: string
          added_by: string
          position?: number
          created_at?: string
        }
        Update: {
          id?: string
          list_id?: string
          shop_id?: string
          added_by?: string
          position?: number
          created_at?: string
        }
        Relationships: []
      }
      group_sessions: {
        Row: {
          id: string
          created_by: string
          shop_candidates: string[]
          quorum: number | null
          status: Database["public"]["Enums"]["group_session_status"]
          resolved_shop_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          created_by: string
          shop_candidates: string[]
          quorum?: number | null
          status?: Database["public"]["Enums"]["group_session_status"]
          resolved_shop_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          created_by?: string
          shop_candidates?: string[]
          quorum?: number | null
          status?: Database["public"]["Enums"]["group_session_status"]
          resolved_shop_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      group_session_votes: {
        Row: {
          id: string
          session_id: string
          participant_token: string
          shop_id: string
          vote: Database["public"]["Enums"]["vote_direction"]
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          participant_token: string
          shop_id: string
          vote: Database["public"]["Enums"]["vote_direction"]
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          participant_token?: string
          shop_id?: string
          vote?: Database["public"]["Enums"]["vote_direction"]
          created_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          actor_id: string | null
          type: string
          payload: Json | null
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          actor_id?: string | null
          type: string
          payload?: Json | null
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          actor_id?: string | null
          type?: string
          payload?: Json | null
          created_at?: string
          read_at?: string | null
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          id: string
          user_id: string | null
          event: string
          props: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          event: string
          props?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          event?: string
          props?: Json | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      shop_intent_tag_tallies: {
        Row: {
          shop_id: string
          intent_tag: Database["public"]["Enums"]["intent_tag"]
          tally: number
        }
        Relationships: []
      }
    }
    Functions: {
      confirm_shop_freshness: {
        Args: { p_shop_id: string }
        Returns: void
      }
      is_friend: {
        Args: { a: string; b: string }
        Returns: boolean
      }
      compute_user_elo: {
        Args: { p_user_id: string }
        Returns: { shop_id: string; elo_score: number }[]
      }
      compute_friend_weighted_rankings: {
        Args: { p_viewer_id: string }
        Returns: { shop_id: string; weighted_score: number; sample_size: number }[]
      }
      can_edit_list: {
        Args: { p_list_id: string; p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      friendship_status: "pending" | "accepted"
      time_bucket: "morning" | "afternoon" | "evening" | "late_night"
      table_size: "laptop" | "laptop_plus_friend" | "mug_only"
      bathroom_access: "open" | "code" | "customer_only"
      shop_photo_type: "room" | "best_seat" | "counter"
      intent_tag:
        | "deep_work"
        | "group_project"
        | "reading"
        | "meeting_someone"
        | "first_date"
        | "quick_grab"
        | "killing_time"
        | "late_night"
        | "just_the_coffee"
      group_session_status: "open" | "resolved" | "cancelled"
      vote_direction: "up" | "down"
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
      friendship_status: ["pending", "accepted"],
      time_bucket: ["morning", "afternoon", "evening", "late_night"],
      table_size: ["laptop", "laptop_plus_friend", "mug_only"],
      bathroom_access: ["open", "code", "customer_only"],
      shop_photo_type: ["room", "best_seat", "counter"],
      intent_tag: [
        "deep_work",
        "group_project",
        "reading",
        "meeting_someone",
        "first_date",
        "quick_grab",
        "killing_time",
        "late_night",
        "just_the_coffee",
      ],
      group_session_status: ["open", "resolved", "cancelled"],
      vote_direction: ["up", "down"],
    },
  },
} as const
