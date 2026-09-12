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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      application_tags: {
        Row: {
          application_id: string
          tag_id: string
        }
        Insert: {
          application_id: string
          tag_id: string
        }
        Update: {
          application_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_tags_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          applicant_email: string
          created_at: string
          email: string
          id: string
          linkedin_url: string
          name: string
          portfolio_url: string
          review_notes: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          applicant_email: string
          created_at?: string
          email: string
          id?: string
          linkedin_url: string
          name: string
          portfolio_url: string
          review_notes?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          applicant_email?: string
          created_at?: string
          email?: string
          id?: string
          linkedin_url?: string
          name?: string
          portfolio_url?: string
          review_notes?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Relationships: []
      }
      cities: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          lottie_format: string | null
          lottie_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      communities: {
        Row: {
          created_at: string
          description: string | null
          enabled_tabs: string[]
          id: string
          image_url: string | null
          invite_token: string
          is_active: boolean
          is_private: boolean
          is_public: boolean
          lottie_format: string | null
          lottie_url: string | null
          member_count: number
          name: string
          owner_id: string | null
          reference_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled_tabs?: string[]
          id?: string
          image_url?: string | null
          invite_token?: string
          is_active?: boolean
          is_private?: boolean
          is_public?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          member_count?: number
          name: string
          owner_id?: string | null
          reference_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled_tabs?: string[]
          id?: string
          image_url?: string | null
          invite_token?: string
          is_active?: boolean
          is_private?: boolean
          is_public?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          member_count?: number
          name?: string
          owner_id?: string | null
          reference_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_admin_activity: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string
          community_id: string
          created_at: string
          details: Json
          id: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string
          community_id: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string
          community_id?: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_admin_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_admin_activity_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_admin_activity_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_admin_permissions: {
        Row: {
          can_delete_messages: boolean
          can_edit_settings: boolean
          can_manage_members: boolean
          community_id: string
          granted_at: string
          granted_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          can_delete_messages?: boolean
          can_edit_settings?: boolean
          can_manage_members?: boolean
          community_id: string
          granted_at?: string
          granted_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          can_delete_messages?: boolean
          can_edit_settings?: boolean
          can_manage_members?: boolean
          community_id?: string
          granted_at?: string
          granted_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_admin_permissions_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_admin_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_admin_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_events: {
        Row: {
          accent_color: string | null
          community_id: string
          cover_image_url: string | null
          created_at: string
          description: string | null
          end_date: string | null
          event_date: string
          id: string
          is_online: boolean
          is_public: boolean
          location: string | null
          max_attendees: number | null
          meet_link: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accent_color?: string | null
          community_id: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_date: string
          id?: string
          is_online?: boolean
          is_public?: boolean
          location?: string | null
          max_attendees?: number | null
          meet_link?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accent_color?: string | null
          community_id?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_date?: string
          id?: string
          is_online?: boolean
          is_public?: boolean
          location?: string | null
          max_attendees?: number | null
          meet_link?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_events_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_join_requests: {
        Row: {
          community_id: string
          decided_at: string | null
          decided_by: string | null
          id: string
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          community_id: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          community_id?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_join_requests_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_join_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_join_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_members: {
        Row: {
          archived_at: string | null
          community_id: string
          history_cleared_at: string | null
          joined_at: string
          last_read_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          community_id: string
          history_cleared_at?: string | null
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          community_id?: string
          history_cleared_at?: string | null
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_messages: {
        Row: {
          community_id: string
          content: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          image_moderated_at: string | null
          image_moderation_error: string | null
          image_status: string | null
          image_url: string | null
          mentions: Json
          moderation_log_id: string | null
          reply_to_id: string | null
          user_id: string
        }
        Insert: {
          community_id: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          image_moderated_at?: string | null
          image_moderation_error?: string | null
          image_status?: string | null
          image_url?: string | null
          mentions?: Json
          moderation_log_id?: string | null
          reply_to_id?: string | null
          user_id: string
        }
        Update: {
          community_id?: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          image_moderated_at?: string | null
          image_moderation_error?: string | null
          image_status?: string | null
          image_url?: string | null
          mentions?: Json
          moderation_log_id?: string | null
          reply_to_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_messages_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_messages_moderation_log_id_fkey"
            columns: ["moderation_log_id"]
            isOneToOne: false
            referencedRelation: "moderation_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "community_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_resources: {
        Row: {
          allow_replies: boolean
          community_id: string
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          resource_type: string
          title: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          allow_replies?: boolean
          community_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          resource_type: string
          title: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          allow_replies?: boolean
          community_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          resource_type?: string
          title?: string
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_resources_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_resources_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_rules: {
        Row: {
          community_id: string
          created_at: string
          id: string
          order_index: number
          rule_text: string
        }
        Insert: {
          community_id: string
          created_at?: string
          id?: string
          order_index?: number
          rule_text: string
        }
        Update: {
          community_id?: string
          created_at?: string
          id?: string
          order_index?: number
          rule_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_rules_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      community_showcase_posts: {
        Row: {
          allow_replies: boolean
          attachments: Json
          category: string
          community_id: string
          created_at: string
          id: string
          image_url: string
          is_public: boolean
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_replies?: boolean
          attachments?: Json
          category: string
          community_id: string
          created_at?: string
          id?: string
          image_url: string
          is_public?: boolean
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_replies?: boolean
          attachments?: Json
          category?: string
          community_id?: string
          created_at?: string
          id?: string
          image_url?: string
          is_public?: boolean
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_showcase_posts_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_showcase_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_threads: {
        Row: {
          allow_replies: boolean
          attachments: Json
          category: string
          community_id: string
          created_at: string
          id: string
          is_public: boolean
          links: string[]
          poll: Json | null
          tags: string[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_replies?: boolean
          attachments?: Json
          category: string
          community_id: string
          created_at?: string
          id?: string
          is_public?: boolean
          links?: string[]
          poll?: Json | null
          tags?: string[]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_replies?: boolean
          attachments?: Json
          category?: string
          community_id?: string
          created_at?: string
          id?: string
          is_public?: boolean
          links?: string[]
          poll?: Json | null
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_threads_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          community_id: string | null
          content_id: string
          content_type: string
          created_at: string
          description: string | null
          id: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          community_id?: string | null
          content_id: string
          content_type: string
          created_at?: string
          description?: string | null
          id?: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          community_id?: string | null
          content_id?: string
          content_type?: string
          created_at?: string
          description?: string | null
          id?: string
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "content_reports_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      design_interests: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          lottie_format: string | null
          lottie_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      design_sectors: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          lottie_format: string | null
          lottie_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      designer_profiles: {
        Row: {
          avatar_source: string | null
          avatar_url: string | null
          bio: string | null
          city_id: string | null
          communities_auto_joined: boolean
          created_at: string
          experience_level: string
          id: string
          linkedin_url: string | null
          portfolio_url: string | null
          sector_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_source?: string | null
          avatar_url?: string | null
          bio?: string | null
          city_id?: string | null
          communities_auto_joined?: boolean
          created_at?: string
          experience_level: string
          id?: string
          linkedin_url?: string | null
          portfolio_url?: string | null
          sector_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_source?: string | null
          avatar_url?: string | null
          bio?: string | null
          city_id?: string | null
          communities_auto_joined?: boolean
          created_at?: string
          experience_level?: string
          id?: string
          linkedin_url?: string | null
          portfolio_url?: string | null
          sector_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "designer_profiles_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designer_profiles_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "design_sectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designer_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_comments: {
        Row: {
          body: string
          created_at: string
          event_id: string
          id: string
          image_url: string | null
          parent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          event_id: string
          id?: string
          image_url?: string | null
          parent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          event_id?: string
          id?: string
          image_url?: string | null
          parent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_comments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "community_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "event_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_likes: {
        Row: {
          created_at: string
          event_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_likes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "community_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "community_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_saves: {
        Row: {
          created_at: string
          event_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_saves_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "community_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      experience_levels: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          lottie_format: string | null
          lottie_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          lottie_format?: string | null
          lottie_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          application_id: string
          created_at: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      lottie_settings: {
        Row: {
          created_at: string
          id: string
          lottie_url: string
          scope: string
          scope_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lottie_url: string
          scope: string
          scope_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lottie_url?: string
          scope?: string
          scope_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          community_id: string
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          community_id: string
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          community_id?: string
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "community_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          moderator_email: string
          reason: string | null
          target_content_id: string | null
          target_content_type: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          moderator_email: string
          reason?: string | null
          target_content_id?: string | null
          target_content_type?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          moderator_email?: string
          reason?: string | null
          target_content_id?: string | null
          target_content_type?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_events: {
        Row: {
          confidence: number
          content_hash: string | null
          content_ref_id: string | null
          content_type: Database["public"]["Enums"]["moderation_content_type"]
          created_at: string
          duration_ms: number
          id: string
          moderator_notes: string | null
          provider: string
          reason: string | null
          scores: Json
          status: Database["public"]["Enums"]["moderation_status"]
          triggered_rules: Json
          user_id: string | null
        }
        Insert: {
          confidence?: number
          content_hash?: string | null
          content_ref_id?: string | null
          content_type: Database["public"]["Enums"]["moderation_content_type"]
          created_at?: string
          duration_ms?: number
          id?: string
          moderator_notes?: string | null
          provider: string
          reason?: string | null
          scores?: Json
          status: Database["public"]["Enums"]["moderation_status"]
          triggered_rules?: Json
          user_id?: string | null
        }
        Update: {
          confidence?: number
          content_hash?: string | null
          content_ref_id?: string | null
          content_type?: Database["public"]["Enums"]["moderation_content_type"]
          created_at?: string
          duration_ms?: number
          id?: string
          moderator_notes?: string | null
          provider?: string
          reason?: string | null
          scores?: Json
          status?: Database["public"]["Enums"]["moderation_status"]
          triggered_rules?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_logs: {
        Row: {
          community_id: string | null
          confidence: number | null
          content_id: string | null
          content_preview: string | null
          content_type: string
          created_at: string
          id: string
          provider: string
          raw_response: Json | null
          reason: string | null
          user_id: string | null
        }
        Insert: {
          community_id?: string | null
          confidence?: number | null
          content_id?: string | null
          content_preview?: string | null
          content_type: string
          created_at?: string
          id?: string
          provider: string
          raw_response?: Json | null
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          community_id?: string | null
          confidence?: number | null
          content_id?: string | null
          content_preview?: string | null
          content_type?: string
          created_at?: string
          id?: string
          provider?: string
          raw_response?: Json | null
          reason?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_logs_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          community_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          href: string
          id: string
          metadata: Json
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          community_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          href: string
          id?: string
          metadata?: Json
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          community_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          href?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      password_resets: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "password_resets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_bookmarks: {
        Row: {
          created_at: string
          resource_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          resource_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          resource_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_bookmarks_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "community_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          parent_id: string | null
          resource_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          resource_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          resource_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "resource_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_comments_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "community_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_saves: {
        Row: {
          created_at: string
          resource_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          resource_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          resource_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_saves_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "community_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      showcase_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          parent_id: string | null
          post_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          post_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          post_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "showcase_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "showcase_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showcase_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_showcase_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showcase_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      showcase_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "showcase_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_showcase_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showcase_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      showcase_saves: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "showcase_saves_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_showcase_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showcase_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      thread_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          emoji: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          emoji: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          emoji?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "thread_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_comment_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          parent_id: string | null
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "thread_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_comments_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "community_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_likes: {
        Row: {
          created_at: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_votes_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "community_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_poll_votes: {
        Row: {
          created_at: string
          option_index: number | null
          thread_id: string
          undo_used: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          option_index?: number | null
          thread_id: string
          undo_used?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          option_index?: number | null
          thread_id?: string
          undo_used?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_poll_votes_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "community_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_saves: {
        Row: {
          created_at: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_saves_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "community_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_interests: {
        Row: {
          created_at: string
          interest_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          interest_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          interest_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_interests_interest_id_fkey"
            columns: ["interest_id"]
            isOneToOne: false
            referencedRelation: "design_interests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_interests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_punishments: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          moderator_note: string | null
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          type: Database["public"]["Enums"]["punishment_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          moderator_note?: string | null
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          type: Database["public"]["Enums"]["punishment_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          moderator_note?: string | null
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          type?: Database["public"]["Enums"]["punishment_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_punishments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          application_id: string | null
          created_at: string
          email: string
          id: string
          is_blocked: boolean
          name: string
          password_hash: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          email: string
          id?: string
          is_blocked?: boolean
          name: string
          password_hash: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          email?: string
          id?: string
          is_blocked?: boolean
          name?: string
          password_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_signup: {
        Args: {
          p_avatar_source: string
          p_avatar_url: string
          p_city_id: string
          p_email: string
          p_experience_level: string
          p_interest_ids: string[]
          p_invitation_token?: string
          p_name: string
          p_password_hash: string
          p_sector_id: string
        }
        Returns: {
          application_id: string
          user_id: string
        }[]
      }
      get_all_communities: {
        Args: { p_user_id: string }
        Returns: {
          can_join: boolean
          description: string
          id: string
          image_url: string
          is_private: boolean
          joined: boolean
          lottie_format: string
          lottie_url: string
          member_count: number
          name: string
          type: string
        }[]
      }
      get_community_message_page: {
        Args: {
          p_after?: string
          p_before?: string
          p_community_id: string
          p_history_start: string
          p_limit?: number
          p_user_id: string
        }
        Returns: {
          content: string
          created_at: string
          deleted_at: string
          edited_at: string
          id: string
          image_url: string
          mentions: Json
          reactions: Json
          reply_to: Json
          reply_to_id: string
          user_id: string
          users: Json
        }[]
      }
      get_event_attendee_previews: {
        Args: { p_event_ids: string[]; p_limit?: number }
        Returns: {
          id: string
          rsvps: Json
        }[]
      }
      get_event_list_aggregates: {
        Args: { p_event_ids?: string[]; p_user_id: string }
        Returns: {
          id: string
          like_count: number
          rsvp_count: number
          save_count: number
          user_liked: boolean
          user_rsvped: boolean
          user_saved: boolean
        }[]
      }
      get_event_list_page: {
        Args: {
          p_community_id: string
          p_cursor_event_date?: string
          p_cursor_id?: string
          p_limit?: number
          p_now?: string
          p_phase?: string
          p_user_id: string
        }
        Returns: {
          item: Json
        }[]
      }
      get_home_feed_interactions: {
        Args: {
          p_event_ids?: string[]
          p_resource_ids?: string[]
          p_thread_ids?: string[]
          p_user_id: string
        }
        Returns: Json
      }
      get_home_feed_page: {
        Args: { p_before?: string; p_limit?: number; p_user_id: string }
        Returns: {
          item: Json
        }[]
      }
      get_resource_list_aggregates: {
        Args: { p_resource_ids?: string[]; p_user_id: string }
        Returns: {
          bookmark_count: number
          comment_count: number
          id: string
          save_count: number
          user_bookmarked: boolean
          user_saved: boolean
        }[]
      }
      get_resource_list_page: {
        Args: {
          p_before?: string
          p_community_id: string
          p_cursor_id?: string
          p_limit?: number
          p_user_id: string
        }
        Returns: {
          item: Json
        }[]
      }
      get_showcase_interactions: {
        Args: { p_post_ids?: string[]; p_user_id: string }
        Returns: Json
      }
      get_showcase_list_page: {
        Args: {
          p_community_id: string
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_limit?: number
          p_user_id: string
        }
        Returns: {
          allow_replies: boolean
          attachments: Json
          author: Json
          category: string
          comment_count: number
          community_id: string
          created_at: string
          id: string
          image_url: string
          is_public: boolean
          like_count: number
          title: string
          updated_at: string
          user_id: string
          user_liked: boolean
          user_saved: boolean
        }[]
      }
      get_sidebar_activity: { Args: { p_user_id: string }; Returns: Json }
      get_thread_list_aggregates: {
        Args: { p_thread_ids?: string[]; p_user_id: string }
        Returns: {
          comment_count: number
          id: string
          like_count: number
          user_liked: boolean
          user_saved: boolean
        }[]
      }
      get_thread_list_page: {
        Args: {
          p_before?: string
          p_community_id: string
          p_cursor_id?: string
          p_limit?: number
          p_user_id: string
        }
        Returns: {
          item: Json
        }[]
      }
    }
    Enums: {
      application_status: "pending" | "approved" | "rejected"
      moderation_content_type:
        | "chat_message"
        | "post"
        | "comment"
        | "username"
        | "user_bio"
        | "community_name"
        | "image_upload"
      moderation_status: "approved" | "review" | "rejected"
      punishment_type: "warning" | "mute" | "temp_ban" | "perm_ban"
      report_reason:
        | "spam"
        | "harassment"
        | "hate"
        | "violence"
        | "nudity"
        | "scam"
        | "copyright"
        | "other"
      report_status: "pending" | "resolved_approve" | "resolved_reject"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      application_status: ["pending", "approved", "rejected"],
      moderation_content_type: [
        "chat_message",
        "post",
        "comment",
        "username",
        "user_bio",
        "community_name",
        "image_upload",
      ],
      moderation_status: ["approved", "review", "rejected"],
      punishment_type: ["warning", "mute", "temp_ban", "perm_ban"],
      report_reason: [
        "spam",
        "harassment",
        "hate",
        "violence",
        "nudity",
        "scam",
        "copyright",
        "other",
      ],
      report_status: ["pending", "resolved_approve", "resolved_reject"],
    },
  },
} as const
