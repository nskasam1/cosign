
-- Create entries table
CREATE TABLE public.entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  place_address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  google_maps_url TEXT NOT NULL,
  drink TEXT NOT NULL,
  notes TEXT,
  photo_url TEXT,
  craft DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  feel DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  visited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- User can read own entries
CREATE POLICY "Users can view own entries"
  ON public.entries FOR SELECT
  USING (auth.uid() = user_id);

-- User can insert own entries
CREATE POLICY "Users can create entries"
  ON public.entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Public read for portfolio API (via service role or anon with specific function)
-- We'll use an edge function with service role for public reads instead

-- Index for performance
CREATE INDEX idx_entries_user_visited ON public.entries (user_id, visited_at DESC);

-- Storage bucket for photos
INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true);

-- Storage policies
CREATE POLICY "Anyone can view photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos');

CREATE POLICY "Authenticated users can upload photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'photos' AND auth.uid() IS NOT NULL);
