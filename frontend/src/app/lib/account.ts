import { supabase } from "./supabaseClient";

/** Every file under a folder of a bucket, at any depth. */
async function listFiles(bucket: string, folder: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
  if (error) throw new Error(error.message);
  const files: string[] = [];
  for (const entry of data ?? []) {
    const path = `${folder}/${entry.name}`;
    // folders come back without an id
    if (entry.id) files.push(path);
    else files.push(...(await listFiles(bucket, path)));
  }
  return files;
}

/**
 * Deletes the signed-in user's account after checking their password: their
 * uploaded floor plans and saved design files first, then the account itself,
 * which takes every database row of theirs with it.
 */
export async function deleteMyAccount(email: string, password: string): Promise<void> {
  const { data: signIn, error: checkErr } = await supabase.auth.signInWithPassword({ email, password });
  if (checkErr || !signIn.user) throw new Error("The password is not correct.");
  const userId = signIn.user.id;

  for (const bucket of ["floorplans", "designs", "avatars"]) {
    const files = await listFiles(bucket, userId);
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(files.slice(i, i + 100));
      if (error) throw new Error(`Removing your files failed: ${error.message}`);
    }
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw new Error(error.message);
  await supabase.auth.signOut();
}
