export interface CommunityEvent {
  id: string;
  community_id: string;
  user_id: string;
  title: string;
  description: string | null;
  event_date: string;       // ISO timestamptz
  end_date: string | null;  // ISO timestamptz
  is_online: boolean;
  location: string | null;
  meet_link: string | null;
  max_attendees: number | null;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
  // enriched
  rsvp_count: number;
  user_rsvped: boolean;
  save_count: number;
  user_saved: boolean;
  users: { name: string; avatar_url: string | null } | null;
}

export interface EventRsvp {
  event_id: string;
  user_id: string;
  created_at: string;
  users: { name: string; avatar_url: string | null } | null;
}

export interface EventComment {
  id: string;
  event_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  users: { name: string; avatar_url: string | null } | null;
  replies?: EventComment[];
}
