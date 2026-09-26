/**
 * Generated database types — do not edit by hand.
 *
 * Regenerate whenever supabase/migrations changes:
 *
 *   npx supabase gen types typescript --linked --schema public > \
 *     apps/web/lib/supabase/database.types.ts
 *
 * (`--linked` needs `supabase link` first. To generate without project access,
 * replay supabase/schema.sql + supabase/migrations into a scratch Postgres and
 * pass its connection string to `--db-url`.)
 *
 * These types are handed to `createClient<Database>()` in
 * apps/web/lib/supabase/service.ts. Without them the `Schema` generic of
 * SupabaseClient collapses to `never` and every query in the app type-checks
 * as `never`.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      application_tags: {
        Row: {
          application_id: string;
          tag_id: string;
        };
        Insert: {
          application_id: string;
          tag_id: string;
        };
        Update: {
          application_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_tags_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "application_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          applicant_email: string;
          created_at: string;
          email: string;
          id: string;
          linkedin_url: string;
          name: string;
          portfolio_url: string;
          review_notes: string | null;
          status: Database["public"]["Enums"]["application_status"];
          updated_at: string;
        };
        Insert: {
          applicant_email: string;
          created_at?: string;
          email: string;
          id?: string;
          linkedin_url: string;
          name: string;
          portfolio_url: string;
          review_notes?: string | null;
          status?: Database["public"]["Enums"]["application_status"];
          updated_at?: string;
        };
        Update: {
          applicant_email?: string;
          created_at?: string;
          email?: string;
          id?: string;
          linkedin_url?: string;
          name?: string;
          portfolio_url?: string;
          review_notes?: string | null;
          status?: Database["public"]["Enums"]["application_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      cities: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          is_active: boolean;
          lottie_format: string | null;
          lottie_url: string | null;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      communities: {
        Row: {
          created_at: string;
          description: string | null;
          enabled_tabs: string[];
          event_id: string | null;
          id: string;
          image_url: string | null;
          invite_token: string;
          is_active: boolean;
          is_private: boolean;
          lottie_format: string | null;
          lottie_url: string | null;
          name: string;
          owner_id: string | null;
          reference_id: string | null;
          showcase_enabled: boolean;
          type: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          enabled_tabs?: string[];
          event_id?: string | null;
          id?: string;
          image_url?: string | null;
          invite_token?: string;
          is_active?: boolean;
          is_private?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name: string;
          owner_id?: string | null;
          reference_id?: string | null;
          showcase_enabled?: boolean;
          type: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          enabled_tabs?: string[];
          event_id?: string | null;
          id?: string;
          image_url?: string | null;
          invite_token?: string;
          is_active?: boolean;
          is_private?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name?: string;
          owner_id?: string | null;
          reference_id?: string | null;
          showcase_enabled?: boolean;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "communities_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "community_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communities_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_admin_activity: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_name: string | null;
          actor_role: string;
          community_id: string;
          created_at: string;
          details: NonNullable<Json>;
          id: string;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_name?: string | null;
          actor_role?: string;
          community_id: string;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_name?: string | null;
          actor_role?: string;
          community_id?: string;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          target_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "community_admin_activity_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_admin_activity_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_admin_activity_target_user_id_fkey";
            columns: ["target_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_admin_permissions: {
        Row: {
          can_delete_messages: boolean;
          can_edit_settings: boolean;
          can_manage_members: boolean;
          community_id: string;
          granted_at: string;
          granted_by: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          can_delete_messages?: boolean;
          can_edit_settings?: boolean;
          can_manage_members?: boolean;
          community_id: string;
          granted_at?: string;
          granted_by?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          can_delete_messages?: boolean;
          can_edit_settings?: boolean;
          can_manage_members?: boolean;
          community_id?: string;
          granted_at?: string;
          granted_by?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_admin_permissions_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_admin_permissions_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_admin_permissions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_events: {
        Row: {
          accent_color: string | null;
          community_id: string;
          cover_image_url: string | null;
          created_at: string;
          description: string | null;
          end_date: string | null;
          event_date: string;
          host_timezone: string | null;
          host_utc_offset_minutes: number | null;
          id: string;
          is_online: boolean;
          is_public: boolean;
          location: string | null;
          max_attendees: number | null;
          meet_link: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          accent_color?: string | null;
          community_id: string;
          cover_image_url?: string | null;
          created_at?: string;
          description?: string | null;
          end_date?: string | null;
          event_date: string;
          host_timezone?: string | null;
          host_utc_offset_minutes?: number | null;
          id?: string;
          is_online?: boolean;
          is_public?: boolean;
          location?: string | null;
          max_attendees?: number | null;
          meet_link?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          accent_color?: string | null;
          community_id?: string;
          cover_image_url?: string | null;
          created_at?: string;
          description?: string | null;
          end_date?: string | null;
          event_date?: string;
          host_timezone?: string | null;
          host_utc_offset_minutes?: number | null;
          id?: string;
          is_online?: boolean;
          is_public?: boolean;
          location?: string | null;
          max_attendees?: number | null;
          meet_link?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_events_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_join_requests: {
        Row: {
          community_id: string;
          decided_at: string | null;
          decided_by: string | null;
          id: string;
          request_message: string | null;
          requested_at: string;
          status: string;
          user_id: string;
        };
        Insert: {
          community_id: string;
          decided_at?: string | null;
          decided_by?: string | null;
          id?: string;
          request_message?: string | null;
          requested_at?: string;
          status?: string;
          user_id: string;
        };
        Update: {
          community_id?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          id?: string;
          request_message?: string | null;
          requested_at?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_join_requests_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_join_requests_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_join_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_members: {
        Row: {
          archived_at: string | null;
          community_id: string;
          history_cleared_at: string | null;
          joined_at: string;
          last_read_at: string | null;
          notifications_muted: boolean;
          role: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          community_id: string;
          history_cleared_at?: string | null;
          joined_at?: string;
          last_read_at?: string | null;
          notifications_muted?: boolean;
          role?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          community_id?: string;
          history_cleared_at?: string | null;
          joined_at?: string;
          last_read_at?: string | null;
          notifications_muted?: boolean;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_messages: {
        Row: {
          community_id: string;
          content: string | null;
          created_at: string;
          deleted_at: string | null;
          edited_at: string | null;
          id: string;
          image_url: string | null;
          mentions: NonNullable<Json>;
          reply_to_content_id: string | null;
          reply_to_id: string | null;
          user_id: string;
        };
        Insert: {
          community_id: string;
          content?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          id?: string;
          image_url?: string | null;
          mentions?: NonNullable<Json>;
          reply_to_content_id?: string | null;
          reply_to_id?: string | null;
          user_id: string;
        };
        Update: {
          community_id?: string;
          content?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          id?: string;
          image_url?: string | null;
          mentions?: NonNullable<Json>;
          reply_to_content_id?: string | null;
          reply_to_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_messages_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_messages_reply_to_id_fkey";
            columns: ["reply_to_id"];
            isOneToOne: false;
            referencedRelation: "community_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_resources: {
        Row: {
          allow_replies: boolean;
          community_id: string;
          created_at: string;
          description: string | null;
          id: string;
          is_public: boolean;
          resource_type: string;
          title: string;
          updated_at: string;
          url: string;
          user_id: string;
        };
        Insert: {
          allow_replies?: boolean;
          community_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_public?: boolean;
          resource_type: string;
          title: string;
          updated_at?: string;
          url: string;
          user_id: string;
        };
        Update: {
          allow_replies?: boolean;
          community_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_public?: boolean;
          resource_type?: string;
          title?: string;
          updated_at?: string;
          url?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_resources_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_resources_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_rules: {
        Row: {
          community_id: string;
          created_at: string;
          id: string;
          order_index: number;
          rule_text: string;
        };
        Insert: {
          community_id: string;
          created_at?: string;
          id?: string;
          order_index?: number;
          rule_text: string;
        };
        Update: {
          community_id?: string;
          created_at?: string;
          id?: string;
          order_index?: number;
          rule_text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_rules_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      community_showcase_posts: {
        Row: {
          allow_replies: boolean;
          attachments: NonNullable<Json>;
          category: string;
          community_id: string;
          created_at: string;
          id: string;
          image_url: string;
          is_public: boolean;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          allow_replies?: boolean;
          attachments?: NonNullable<Json>;
          category: string;
          community_id: string;
          created_at?: string;
          id?: string;
          image_url: string;
          is_public?: boolean;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          allow_replies?: boolean;
          attachments?: NonNullable<Json>;
          category?: string;
          community_id?: string;
          created_at?: string;
          id?: string;
          image_url?: string;
          is_public?: boolean;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_showcase_posts_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_showcase_posts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_threads: {
        Row: {
          allow_replies: boolean;
          attachments: NonNullable<Json>;
          category: string;
          community_id: string;
          created_at: string;
          id: string;
          is_public: boolean;
          links: string[];
          poll: Json | null;
          tags: string[];
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          allow_replies?: boolean;
          attachments?: NonNullable<Json>;
          category: string;
          community_id: string;
          created_at?: string;
          id?: string;
          is_public?: boolean;
          links?: string[];
          poll?: Json | null;
          tags?: string[];
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          allow_replies?: boolean;
          attachments?: NonNullable<Json>;
          category?: string;
          community_id?: string;
          created_at?: string;
          id?: string;
          is_public?: boolean;
          links?: string[];
          poll?: Json | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_threads_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_threads_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      content_reactions: {
        Row: {
          community_id: string;
          content_id: string;
          content_kind: string;
          created_at: string;
          emoji: string;
          id: string;
          user_id: string;
        };
        Insert: {
          community_id: string;
          content_id: string;
          content_kind: string;
          created_at?: string;
          emoji: string;
          id?: string;
          user_id: string;
        };
        Update: {
          community_id?: string;
          content_id?: string;
          content_kind?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_reactions_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      design_interests: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          is_active: boolean;
          lottie_format: string | null;
          lottie_url: string | null;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      design_sectors: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          is_active: boolean;
          lottie_format: string | null;
          lottie_url: string | null;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      designer_profiles: {
        Row: {
          avatar_source: string | null;
          avatar_url: string | null;
          banner_url: string | null;
          bio: string | null;
          city_id: string | null;
          communities_auto_joined: boolean;
          created_at: string;
          experience_level: string;
          id: string;
          job_title: string | null;
          linkedin_url: string | null;
          portfolio_url: string | null;
          sector_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_source?: string | null;
          avatar_url?: string | null;
          banner_url?: string | null;
          bio?: string | null;
          city_id?: string | null;
          communities_auto_joined?: boolean;
          created_at?: string;
          experience_level: string;
          id?: string;
          job_title?: string | null;
          linkedin_url?: string | null;
          portfolio_url?: string | null;
          sector_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_source?: string | null;
          avatar_url?: string | null;
          banner_url?: string | null;
          bio?: string | null;
          city_id?: string | null;
          communities_auto_joined?: boolean;
          created_at?: string;
          experience_level?: string;
          id?: string;
          job_title?: string | null;
          linkedin_url?: string | null;
          portfolio_url?: string | null;
          sector_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "designer_profiles_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "designer_profiles_job_title_fkey";
            columns: ["job_title"];
            isOneToOne: false;
            referencedRelation: "job_titles";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "designer_profiles_sector_id_fkey";
            columns: ["sector_id"];
            isOneToOne: false;
            referencedRelation: "design_sectors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "designer_profiles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      event_chat_join_responses: {
        Row: {
          community_id: string;
          company_name: string;
          created_at: string;
          expectations: string;
          updated_at: string;
          user_id: string;
          why_attend: string;
          work_experience: string;
        };
        Insert: {
          community_id: string;
          company_name: string;
          created_at?: string;
          expectations: string;
          updated_at?: string;
          user_id: string;
          why_attend: string;
          work_experience: string;
        };
        Update: {
          community_id?: string;
          company_name?: string;
          created_at?: string;
          expectations?: string;
          updated_at?: string;
          user_id?: string;
          why_attend?: string;
          work_experience?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_chat_join_responses_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_chat_join_responses_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      event_comment_reactions: {
        Row: {
          comment_id: string;
          created_at: string;
          emoji: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          emoji: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_comment_reactions_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "event_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_comment_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      event_comments: {
        Row: {
          body: string;
          created_at: string;
          event_id: string;
          id: string;
          image_url: string | null;
          parent_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          event_id: string;
          id?: string;
          image_url?: string | null;
          parent_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          event_id?: string;
          id?: string;
          image_url?: string | null;
          parent_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_comments_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "community_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "event_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      event_likes: {
        Row: {
          created_at: string;
          event_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_likes_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "community_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      event_rsvps: {
        Row: {
          created_at: string;
          event_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "community_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      event_saves: {
        Row: {
          created_at: string;
          event_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_saves_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "community_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_saves_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      experience_levels: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          is_active: boolean;
          lottie_format: string | null;
          lottie_url: string | null;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          application_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          token: string;
          used_at: string | null;
        };
        Insert: {
          application_id: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Update: {
          application_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      job_titles: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          is_active: boolean;
          lottie_format: string | null;
          lottie_url: string | null;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          lottie_format?: string | null;
          lottie_url?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lottie_settings: {
        Row: {
          created_at: string;
          id: string;
          lottie_url: string;
          scope: string;
          scope_key: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lottie_url: string;
          scope: string;
          scope_key: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lottie_url?: string;
          scope?: string;
          scope_key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      message_reactions: {
        Row: {
          community_id: string;
          created_at: string;
          emoji: string;
          id: string;
          message_id: string;
          user_id: string;
        };
        Insert: {
          community_id: string;
          created_at?: string;
          emoji: string;
          id?: string;
          message_id: string;
          user_id: string;
        };
        Update: {
          community_id?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          message_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "message_reactions_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "community_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          chat_push_enabled: boolean;
          chat_sound: string;
          created_at: string;
          quiet_hours_enabled: boolean;
          quiet_hours_end: string;
          quiet_hours_start: string;
          quiet_hours_timezone: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          chat_push_enabled?: boolean;
          chat_sound?: string;
          created_at?: string;
          quiet_hours_enabled?: boolean;
          quiet_hours_end?: string;
          quiet_hours_start?: string;
          quiet_hours_timezone?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          chat_push_enabled?: boolean;
          chat_sound?: string;
          created_at?: string;
          quiet_hours_enabled?: boolean;
          quiet_hours_end?: string;
          quiet_hours_start?: string;
          quiet_hours_timezone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          actor_id: string | null;
          body: string | null;
          community_id: string | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          href: string;
          id: string;
          metadata: NonNullable<Json>;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          actor_id?: string | null;
          body?: string | null;
          community_id?: string | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          href: string;
          id?: string;
          metadata?: NonNullable<Json>;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          actor_id?: string | null;
          body?: string | null;
          community_id?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          href?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      password_resets: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          token: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "password_resets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      push_throttle: {
        Row: {
          community_id: string;
          sent_count: number;
          user_id: string;
          window_started_at: string;
        };
        Insert: {
          community_id: string;
          sent_count?: number;
          user_id: string;
          window_started_at?: string;
        };
        Update: {
          community_id?: string;
          sent_count?: number;
          user_id?: string;
          window_started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_throttle_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "push_throttle_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      push_tokens: {
        Row: {
          created_at: string;
          platform: string;
          token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          platform: string;
          token: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          platform?: string;
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      resource_bookmarks: {
        Row: {
          created_at: string;
          resource_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          resource_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          resource_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resource_bookmarks_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "community_resources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_bookmarks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      resource_comment_reactions: {
        Row: {
          comment_id: string;
          created_at: string;
          emoji: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          emoji: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resource_comment_reactions_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "resource_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_comment_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      resource_comments: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          parent_id: string | null;
          resource_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          parent_id?: string | null;
          resource_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          parent_id?: string | null;
          resource_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resource_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "resource_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_comments_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "community_resources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      resource_saves: {
        Row: {
          created_at: string;
          resource_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          resource_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          resource_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resource_saves_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "community_resources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_saves_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      showcase_comment_reactions: {
        Row: {
          comment_id: string;
          created_at: string;
          emoji: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          emoji: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "showcase_comment_reactions_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "showcase_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "showcase_comment_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      showcase_comments: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          parent_id: string | null;
          post_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          parent_id?: string | null;
          post_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          parent_id?: string | null;
          post_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "showcase_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "showcase_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "showcase_comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "community_showcase_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "showcase_comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      showcase_likes: {
        Row: {
          created_at: string;
          post_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "showcase_likes_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "community_showcase_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "showcase_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      showcase_saves: {
        Row: {
          created_at: string;
          post_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "showcase_saves_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "community_showcase_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "showcase_saves_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      signup_attempts: {
        Row: {
          application_id: string | null;
          completed_at: string | null;
          email: string;
          flow: string;
          id: string;
          name: string | null;
          resume_email_sent_at: string | null;
          resume_token: string | null;
          resume_token_expires_at: string | null;
          started_at: string;
          status: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          application_id?: string | null;
          completed_at?: string | null;
          email: string;
          flow?: string;
          id?: string;
          name?: string | null;
          resume_email_sent_at?: string | null;
          resume_token?: string | null;
          resume_token_expires_at?: string | null;
          started_at?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          application_id?: string | null;
          completed_at?: string | null;
          email?: string;
          flow?: string;
          id?: string;
          name?: string | null;
          resume_email_sent_at?: string | null;
          resume_token?: string | null;
          resume_token_expires_at?: string | null;
          started_at?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "signup_attempts_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signup_attempts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          id: string;
          name: string;
        };
        Insert: {
          id?: string;
          name: string;
        };
        Update: {
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      thread_comment_reactions: {
        Row: {
          comment_id: string;
          created_at: string;
          emoji: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          emoji: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thread_comment_reactions_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "thread_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_comment_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      thread_comments: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          parent_id: string | null;
          thread_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          parent_id?: string | null;
          thread_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          parent_id?: string | null;
          thread_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thread_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "thread_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_comments_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "community_threads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      thread_likes: {
        Row: {
          created_at: string;
          thread_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          thread_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          thread_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thread_votes_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "community_threads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_votes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      thread_poll_votes: {
        Row: {
          created_at: string;
          option_index: number | null;
          thread_id: string;
          undo_used: boolean;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          option_index?: number | null;
          thread_id: string;
          undo_used?: boolean;
          user_id: string;
        };
        Update: {
          created_at?: string;
          option_index?: number | null;
          thread_id?: string;
          undo_used?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thread_poll_votes_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "community_threads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_poll_votes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      thread_saves: {
        Row: {
          created_at: string;
          thread_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          thread_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          thread_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thread_saves_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "community_threads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_saves_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      user_interests: {
        Row: {
          created_at: string;
          interest_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          interest_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          interest_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_interests_interest_id_fkey";
            columns: ["interest_id"];
            isOneToOne: false;
            referencedRelation: "design_interests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_interests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          application_id: string | null;
          created_at: string;
          email: string;
          id: string;
          is_blocked: boolean;
          name: string;
          password_hash: string;
          updated_at: string;
        };
        Insert: {
          application_id?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          is_blocked?: boolean;
          name: string;
          password_hash: string;
          updated_at?: string;
        };
        Update: {
          application_id?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          is_blocked?: boolean;
          name?: string;
          password_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "users_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: true;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      complete_signup: {
        Args: {
          p_avatar_source: string;
          p_avatar_url: string;
          p_city_id: string;
          p_email: string;
          p_experience_level: string;
          p_interest_ids: string[];
          p_invitation_token?: string;
          p_job_title: string;
          p_name: string;
          p_password_hash: string;
          p_sector_id: string;
        };
        Returns: {
          application_id: string;
          user_id: string;
        }[];
      };
      dearmor: { Args: { "": string }; Returns: string };
      gen_random_uuid: { Args: Record<PropertyKey, never>; Returns: string };
      gen_salt: { Args: { "": string }; Returns: string };
      get_all_communities: {
        Args: { p_user_id: string };
        Returns: {
          can_join: boolean;
          description: string;
          id: string;
          image_url: string;
          is_private: boolean;
          joined: boolean;
          lottie_format: string;
          lottie_url: string;
          member_count: number;
          name: string;
          type: string;
        }[];
      };
      get_community_message_page:
        | {
            Args: {
              p_after?: string;
              p_before?: string;
              p_community_id: string;
              p_history_start: string;
              p_limit?: number;
              p_user_id: string;
            };
            Returns: {
              content: string;
              created_at: string;
              deleted_at: string;
              edited_at: string;
              id: string;
              image_url: string;
              mentions: Json;
              reactions: Json;
              reply_to: Json;
              reply_to_id: string;
              user_id: string;
              users: Json;
            }[];
          }
        | {
            Args: {
              p_after?: string;
              p_before?: string;
              p_community_id: string;
              p_content_ids?: string[];
              p_history_start: string;
              p_limit?: number;
              p_user_id: string;
            };
            Returns: {
              content: string;
              content_reactions: Json;
              created_at: string;
              deleted_at: string;
              edited_at: string;
              id: string;
              image_url: string;
              mentions: Json;
              reactions: Json;
              reply_to: Json;
              reply_to_content: Json;
              reply_to_content_id: string;
              reply_to_id: string;
              user_id: string;
              users: Json;
            }[];
          };
      get_event_attendee_previews: {
        Args: { p_event_ids: string[]; p_limit?: number };
        Returns: {
          id: string;
          rsvps: Json;
        }[];
      };
      get_event_list_aggregates: {
        Args: { p_event_ids?: string[]; p_user_id: string };
        Returns: {
          id: string;
          like_count: number;
          rsvp_count: number;
          save_count: number;
          user_liked: boolean;
          user_rsvped: boolean;
          user_saved: boolean;
        }[];
      };
      get_event_list_page: {
        Args: {
          p_community_id: string;
          p_cursor_event_date?: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_now?: string;
          p_phase?: string;
          p_user_id: string;
        };
        Returns: {
          item: Json;
        }[];
      };
      get_home_feed_interactions: {
        Args: {
          p_event_ids?: string[];
          p_resource_ids?: string[];
          p_thread_ids?: string[];
          p_user_id: string;
        };
        Returns: Json;
      };
      get_home_feed_page:
        | {
            Args: { p_before?: string; p_limit?: number; p_user_id: string };
            Returns: {
              item: Json;
            }[];
          }
        | {
            Args: {
              p_before?: string;
              p_limit?: number;
              p_member_only?: boolean;
              p_user_id: string;
            };
            Returns: {
              item: Json;
            }[];
          }
        | {
            Args: { p_before?: string; p_limit?: number; p_scope?: string; p_user_id: string };
            Returns: {
              item: Json;
            }[];
          };
      get_profile_feed_page: {
        Args: { p_before?: string; p_limit?: number; p_scope?: string; p_user_id: string };
        Returns: {
          item: Json;
        }[];
      };
      get_resource_list_aggregates: {
        Args: { p_resource_ids?: string[]; p_user_id: string };
        Returns: {
          allow_replies: boolean;
          bookmark_count: number;
          comment_count: number;
          id: string;
          save_count: number;
          user_bookmarked: boolean;
          user_saved: boolean;
        }[];
      };
      get_resource_list_page: {
        Args: {
          p_before?: string;
          p_community_id: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_user_id: string;
        };
        Returns: {
          item: Json;
        }[];
      };
      get_showcase_interactions: {
        Args: { p_post_ids?: string[]; p_user_id: string };
        Returns: Json;
      };
      get_showcase_list_page: {
        Args: {
          p_community_id: string;
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_user_id: string;
        };
        Returns: {
          allow_replies: boolean;
          attachments: Json;
          author: Json;
          category: string;
          comment_count: number;
          community_id: string;
          created_at: string;
          id: string;
          image_url: string;
          is_public: boolean;
          like_count: number;
          title: string;
          updated_at: string;
          user_id: string;
          user_liked: boolean;
          user_saved: boolean;
        }[];
      };
      get_sidebar_activity: { Args: { p_user_id: string }; Returns: Json };
      get_thread_list_aggregates: {
        Args: { p_thread_ids?: string[]; p_user_id: string };
        Returns: {
          comment_count: number;
          id: string;
          like_count: number;
          user_liked: boolean;
          user_saved: boolean;
        }[];
      };
      get_thread_list_page: {
        Args: {
          p_before?: string;
          p_community_id: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_user_id: string;
        };
        Returns: {
          item: Json;
        }[];
      };
      get_unread_message_totals: {
        Args: { p_user_ids: string[] };
        Returns: {
          unread: number;
          user_id: string;
        }[];
      };
      pgp_armor_headers: { Args: { "": string }; Returns: Record<string, unknown>[] };
    };
    Enums: {
      application_status: "pending" | "approved" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      application_status: ["pending", "approved", "rejected"],
    },
  },
} as const;
