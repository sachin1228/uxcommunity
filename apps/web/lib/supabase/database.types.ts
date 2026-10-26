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
      account_verification_requests: {
        Row: {
          created_at: string;
          email_verified_at: string;
          id: string;
          linkedin_url: string;
          portfolio_links: string[];
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          updated_at: string;
          user_id: string;
          work_sample_urls: string[];
        };
        Insert: {
          created_at?: string;
          email_verified_at: string;
          id?: string;
          linkedin_url: string;
          portfolio_links: string[];
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
          work_sample_urls?: string[];
        };
        Update: {
          created_at?: string;
          email_verified_at?: string;
          id?: string;
          linkedin_url?: string;
          portfolio_links?: string[];
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
          work_sample_urls?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "account_verification_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
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
          member_count: number;
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
          member_count?: number;
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
          member_count?: number;
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
          can_moderate_events: boolean;
          can_moderate_resources: boolean;
          can_moderate_showcase: boolean;
          can_moderate_threads: boolean;
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
          can_moderate_events?: boolean;
          can_moderate_resources?: boolean;
          can_moderate_showcase?: boolean;
          can_moderate_threads?: boolean;
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
          can_moderate_events?: boolean;
          can_moderate_resources?: boolean;
          can_moderate_showcase?: boolean;
          can_moderate_threads?: boolean;
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
          notifications_muted_until: string | null;
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
          notifications_muted_until?: string | null;
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
          notifications_muted_until?: string | null;
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
          deleted_by: string | null;
          deleted_by_role: string | null;
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
          deleted_by?: string | null;
          deleted_by_role?: string | null;
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
          deleted_by?: string | null;
          deleted_by_role?: string | null;
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
      content_removals: {
        Row: {
          community_id: string | null;
          content_author_id: string | null;
          content_id: string;
          content_title: string | null;
          content_type: string;
          id: string;
          removed_at: string;
          removed_by: string | null;
          snapshot: Json;
          undone_at: string | null;
          undone_by: string | null;
        };
        Insert: {
          community_id?: string | null;
          content_author_id?: string | null;
          content_id: string;
          content_title?: string | null;
          content_type: string;
          id?: string;
          removed_at?: string;
          removed_by?: string | null;
          snapshot: Json;
          undone_at?: string | null;
          undone_by?: string | null;
        };
        Update: {
          community_id?: string | null;
          content_author_id?: string | null;
          content_id?: string;
          content_title?: string | null;
          content_type?: string;
          id?: string;
          removed_at?: string;
          removed_by?: string | null;
          snapshot?: Json;
          undone_at?: string | null;
          undone_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "content_removals_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_removals_content_author_id_fkey";
            columns: ["content_author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_removals_removed_by_fkey";
            columns: ["removed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_removals_undone_by_fkey";
            columns: ["undone_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      content_reports: {
        Row: {
          community_id: string | null;
          content_author_id: string | null;
          content_id: string;
          content_title: string | null;
          content_type: string;
          created_at: string;
          details: string | null;
          id: string;
          reason: string;
          reporter_id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
        };
        Insert: {
          community_id?: string | null;
          content_author_id?: string | null;
          content_id: string;
          content_title?: string | null;
          content_type: string;
          created_at?: string;
          details?: string | null;
          id?: string;
          reason: string;
          reporter_id: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Update: {
          community_id?: string | null;
          content_author_id?: string | null;
          content_id?: string;
          content_title?: string | null;
          content_type?: string;
          created_at?: string;
          details?: string | null;
          id?: string;
          reason?: string;
          reporter_id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_reports_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_reports_content_author_id_fkey";
            columns: ["content_author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_reports_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
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
      dm_blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
          id: string;
        };
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
          id?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dm_blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      dm_conversations: {
        Row: {
          created_at: string;
          id: string;
          last_message_at: string | null;
          request_state: string;
          requested_by: string | null;
          user_a: string;
          user_a_last_read_at: string | null;
          user_b: string;
          user_b_last_read_at: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          request_state?: string;
          requested_by?: string | null;
          user_a: string;
          user_a_last_read_at?: string | null;
          user_b: string;
          user_b_last_read_at?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          request_state?: string;
          requested_by?: string | null;
          user_a?: string;
          user_a_last_read_at?: string | null;
          user_b?: string;
          user_b_last_read_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dm_conversations_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_conversations_user_a_fkey";
            columns: ["user_a"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_conversations_user_b_fkey";
            columns: ["user_b"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      dm_message_reactions: {
        Row: {
          conversation_id: string;
          created_at: string;
          emoji: string;
          id: string;
          message_id: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          emoji: string;
          id?: string;
          message_id: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          message_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dm_message_reactions_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "dm_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_message_reactions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "dm_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_message_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      dm_messages: {
        Row: {
          client_nonce: string | null;
          content: string | null;
          conversation_id: string;
          created_at: string;
          deleted_at: string | null;
          edited_at: string | null;
          id: string;
          image_url: string | null;
          reply_to_id: string | null;
          user_id: string;
        };
        Insert: {
          client_nonce?: string | null;
          content?: string | null;
          conversation_id: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          id?: string;
          image_url?: string | null;
          reply_to_id?: string | null;
          user_id: string;
        };
        Update: {
          client_nonce?: string | null;
          content?: string | null;
          conversation_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          id?: string;
          image_url?: string | null;
          reply_to_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dm_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "dm_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_messages_reply_to_id_fkey";
            columns: ["reply_to_id"];
            isOneToOne: false;
            referencedRelation: "dm_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      dm_reports: {
        Row: {
          conversation_id: string | null;
          created_at: string;
          details: string | null;
          id: string;
          message_snapshot: Json;
          reason: string;
          reported_user_id: string | null;
          reporter_id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
        };
        Insert: {
          conversation_id?: string | null;
          created_at?: string;
          details?: string | null;
          id?: string;
          message_snapshot?: Json;
          reason: string;
          reported_user_id?: string | null;
          reporter_id: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Update: {
          conversation_id?: string | null;
          created_at?: string;
          details?: string | null;
          id?: string;
          message_snapshot?: Json;
          reason?: string;
          reported_user_id?: string | null;
          reporter_id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dm_reports_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "dm_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_reports_reported_user_id_fkey";
            columns: ["reported_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dm_reports_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      event_chat_join_responses: {
        Row: {
          community_id: string;
          created_at: string;
          expectations: string;
          updated_at: string;
          user_id: string;
          why_attend: string;
        };
        Insert: {
          community_id: string;
          created_at?: string;
          expectations: string;
          updated_at?: string;
          user_id: string;
          why_attend: string;
        };
        Update: {
          community_id?: string;
          created_at?: string;
          expectations?: string;
          updated_at?: string;
          user_id?: string;
          why_attend?: string;
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
      event_notification_deliveries: {
        Row: {
          event_id: string;
          sent_at: string;
          stage: string;
          user_id: string;
        };
        Insert: {
          event_id: string;
          sent_at?: string;
          stage: string;
          user_id: string;
        };
        Update: {
          event_id?: string;
          sent_at?: string;
          stage?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_notification_deliveries_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "community_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_notification_deliveries_user_id_fkey";
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
      member_resumes: {
        Row: {
          created_at: string;
          file_name: string;
          id: string;
          is_default: boolean;
          mime_type: string;
          size_bytes: number;
          url: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          id?: string;
          is_default?: boolean;
          mime_type: string;
          size_bytes: number;
          url: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          id?: string;
          is_default?: boolean;
          mime_type?: string;
          size_bytes?: number;
          url?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_resumes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
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
          community_push_enabled: boolean;
          created_at: string;
          email_community_activity: boolean;
          email_job_updates: boolean;
          email_product_news: boolean;
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
          community_push_enabled?: boolean;
          created_at?: string;
          email_community_activity?: boolean;
          email_job_updates?: boolean;
          email_product_news?: boolean;
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
          community_push_enabled?: boolean;
          created_at?: string;
          email_community_activity?: boolean;
          email_job_updates?: boolean;
          email_product_news?: boolean;
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
      profile_field_changes: {
        Row: {
          changed_at: string;
          field: string;
          user_id: string;
        };
        Insert: {
          changed_at?: string;
          field: string;
          user_id: string;
        };
        Update: {
          changed_at?: string;
          field?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_field_changes_user_id_fkey";
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
      companies: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          is_active: boolean;
          logo_url: string | null;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      job_posts: {
        Row: {
          city_id: string;
          company_id: string;
          created_at: string;
          description: string;
          employment_type: string;
          experience_level: string;
          id: string;
          job_title: string;
          kind: string;
          poster_id: string;
          requirements: string[];
          responsibilities: string[];
          salary: string | null;
          sector_id: string;
          skills: string[];
          title: string;
          website: string | null;
          work_mode: string;
        };
        Insert: {
          city_id: string;
          company_id: string;
          created_at?: string;
          description: string;
          employment_type: string;
          experience_level: string;
          id?: string;
          job_title: string;
          kind: string;
          poster_id: string;
          requirements?: string[];
          responsibilities?: string[];
          salary?: string | null;
          sector_id: string;
          skills?: string[];
          title: string;
          website?: string | null;
          work_mode: string;
        };
        Update: {
          city_id?: string;
          company_id?: string;
          created_at?: string;
          description?: string;
          employment_type?: string;
          experience_level?: string;
          id?: string;
          job_title?: string;
          kind?: string;
          poster_id?: string;
          requirements?: string[];
          responsibilities?: string[];
          salary?: string | null;
          sector_id?: string;
          skills?: string[];
          title?: string;
          website?: string | null;
          work_mode?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_posts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      fcm_tokens: {
        Row: {
          token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          token: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fcm_tokens_user_id_fkey";
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
      verification_settings: {
        Row: {
          grace_days: number;
          id: boolean;
          updated_at: string;
        };
        Insert: {
          grace_days?: number;
          id?: boolean;
          updated_at?: string;
        };
        Update: {
          grace_days?: number;
          id?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      verification_email_codes: {
        Row: {
          attempts: number;
          code_hash: string;
          created_at: string;
          expires_at: string;
          last_sent_at: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          created_at?: string;
          expires_at: string;
          last_sent_at?: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          created_at?: string;
          expires_at?: string;
          last_sent_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "verification_email_codes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
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
          email_verified_at: string | null;
          id: string;
          is_blocked: boolean;
          name: string;
          password_hash: string;
          updated_at: string;
          verification_notified_at: string | null;
          verification_reapply_at: string | null;
          verification_rejection_reason: string | null;
          verification_reviewed_at: string | null;
          verification_status: string;
        };
        Insert: {
          application_id?: string | null;
          created_at?: string;
          email: string;
          email_verified_at?: string | null;
          id?: string;
          is_blocked?: boolean;
          name: string;
          password_hash: string;
          updated_at?: string;
          verification_notified_at?: string | null;
          verification_reapply_at?: string | null;
          verification_rejection_reason?: string | null;
          verification_reviewed_at?: string | null;
          verification_status?: string;
        };
        Update: {
          application_id?: string | null;
          created_at?: string;
          email?: string;
          email_verified_at?: string | null;
          id?: string;
          is_blocked?: boolean;
          name?: string;
          password_hash?: string;
          updated_at?: string;
          verification_notified_at?: string | null;
          verification_reapply_at?: string | null;
          verification_rejection_reason?: string | null;
          verification_reviewed_at?: string | null;
          verification_status?: string;
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
      admin_create_company: {
        Args: {
          p_name: string;
          p_domain?: string | null;
          p_logo_url?: string | null;
        };
        Returns: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          is_active: boolean;
          domain: string | null;
        }[];
      };
      admin_featured_companies: {
        Args: Record<PropertyKey, never>;
        Returns: {
          "position": number;
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          domain: string | null;
          domain_verified: boolean;
          member_count: number;
        }[];
      };
      admin_list_companies: {
        Args: {
          p_query?: string;
          p_all?: boolean;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          is_active: boolean;
          created_at: string;
          domain: string | null;
          domain_verified: boolean;
          domain_count: number;
          member_count: number;
          total_count: number;
          featured_rank: number | null;
        }[];
      };
      admin_move_company_featured: {
        Args: { p_id: string; p_direction: number };
        Returns: number;
      };
      admin_set_company_featured: {
        Args: { p_id: string; p_featured: boolean };
        Returns: number;
      };
      admin_update_company: {
        Args: {
          p_id: string;
          p_name?: string | null;
          p_is_active?: boolean | null;
          p_logo_url?: string | null;
        };
        Returns: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          is_active: boolean;
        }[];
      };
      admin_delete_company: {
        Args: { p_id: string };
        Returns: boolean;
      };
      complete_signup: {
        Args: {
          p_avatar_source: string;
          p_avatar_url: string;
          p_city_id: string;
          p_email: string;
          p_experience_level: string;
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
      review_account_verification: {
        Args: {
          p_action: string;
          p_reason: string | null;
          p_request_id: string;
          p_reviewed_by: string;
        };
        Returns: {
          rejection_reason: string | null;
          reapply_at: string | null;
          user_email: string;
          user_id: string;
          user_name: string | null;
          verification_status: string;
        }[];
      };
      gen_random_uuid: { Args: Record<PropertyKey, never>; Returns: string };
      gen_salt: { Args: { "": string }; Returns: string };
      get_all_communities: {
        Args: { p_user_id: string };
        Returns: {
          can_join: boolean;
          description: string;
          has_pending_request: boolean;
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
      get_dm_conversations: {
        Args: { p_user_id: string };
        Returns: {
          conversation_id: string;
          last_message: Json;
          last_message_at: string;
          my_last_read_at: string;
          peer: Json;
          unread_count: number;
        }[];
      };
      get_dm_message_page: {
        Args: {
          p_after?: string;
          p_after_id?: string;
          p_before?: string;
          p_before_id?: string;
          p_conversation_id: string;
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
          reactions: Json;
          reply_to: Json;
          reply_to_id: string;
          user_id: string;
          users: Json;
        }[];
      };
      get_dm_unread_total: {
        Args: { p_user_id: string };
        Returns: number;
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
      get_or_create_dm_conversation: {
        Args: { p_me: string; p_peer: string };
        Returns: {
          created_at: string;
          id: string;
          last_message_at: string;
          my_last_read_at: string;
          user_a: string;
          user_b: string;
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
      update_profile_identity: {
        Args: {
          p_user_id: string;
          p_name?: string;
          p_city_id?: string;
          p_sector_id?: string;
          p_experience_level?: string;
          p_job_title?: string;
        };
        Returns: Json;
      };
      mark_dm_conversation_read: {
        Args: {
          p_conversation_id: string;
          p_last_read_at?: string;
          p_user_id: string;
        };
        Returns: {
          marked_at: string;
          previous_marked_at: string;
        }[];
      };
      admin_join_all_communities: {
        Args: { p_user_id: string };
        Returns: number;
      };
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
