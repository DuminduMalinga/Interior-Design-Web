-- Migration: Handle new user profile creation with safe username length bounds (<= 50 chars)
-- Preserves SECURITY DEFINER, search_path = '', FullName fallback, and Customer role.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_full_name text;
  v_username text;
  v_email_prefix text;
BEGIN
  -- Extract and sanitize email prefix
  v_email_prefix := split_part(COALESCE(NEW.email, ''), '@', 1);

  -- Determine FullName in priority order: full_name -> name -> email_prefix -> 'User'
  v_full_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
    NULLIF(trim(v_email_prefix), ''),
    'User'
  );

  -- Determine UserName: explicit username (bounded <= 50) -> deterministic bounded prefix (17 chars) + clean uuid
  IF NEW.raw_user_meta_data->>'username' IS NOT NULL AND trim(NEW.raw_user_meta_data->>'username') <> '' THEN
    IF length(trim(NEW.raw_user_meta_data->>'username')) <= 50 THEN
      v_username := trim(NEW.raw_user_meta_data->>'username');
    ELSE
      v_username := left(trim(NEW.raw_user_meta_data->>'username'), 17) || '_' || replace(NEW.id::text, '-', '');
    END IF;
  ELSE
    v_username := left(v_email_prefix, 17) || '_' || replace(NEW.id::text, '-', '');
  END IF;

  -- Insert profile with fixed 'Customer' role
  INSERT INTO public."User" (
    "UserID",
    "UserName",
    "Email",
    "FullName",
    "Role"
  ) VALUES (
    NEW.id,
    v_username,
    NEW.email,
    v_full_name,
    'Customer'
  );

  RETURN NEW;
END;
$function$;
