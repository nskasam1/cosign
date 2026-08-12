import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { Profile } from "@/types/cosign";

export const useProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (data) setProfile(data as Profile);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const createProfile = async (username: string, extra: Partial<Omit<Profile, "id" | "username" | "created_at">> = {}) => {
    if (!user) return;
    const { data, error } = await supabase
      .from("profiles")
      .insert({ id: user.id, username, ...extra })
      .select()
      .single();
    if (!error && data) setProfile(data as Profile);
    return error;
  };

  const updateProfile = async (updates: Partial<Omit<Profile, "id" | "created_at">>) => {
    if (!user) return;
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .single();
    if (!error && data) setProfile(data as Profile);
    return error;
  };

  const uploadAvatar = async (file: File): Promise<string | null> => {
    if (!user) return null;
    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
  };

  return { profile, loading, fetchProfile, createProfile, updateProfile, uploadAvatar };
};
