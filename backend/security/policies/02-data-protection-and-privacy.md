# 02 Data protection & privacy

## Data inventory
| Data | Sensitivity | Where |
|------|-------------|-------|
| Email, username, name, role | Personal | Supabase `auth.users`, `public."User"` |
| Phone, location, bio (optional, entered on the profile) | Personal | `public."User"` |
| Profile picture | Personal | Storage bucket `avatars` (public by design, owner-only write) |
| Floor plan images | Potentially personal (home layout) | Storage bucket `floorplans` (private once migration `20261020100000` is applied) |
| Saved designs, analyses, detected rooms | User content | `"SavedDesign"`, `"FloorPlanAnalysis"`, `"Room"`, `"Layout"`, bucket `designs` (private) |
| Admin actions | Operational | `"AdminAuditLog"` (admins read only) |
| Notification email content | Personal | Resend (processor) |

## Rules
- **Collect the minimum.** Phone, location and bio are optional profile fields. No postal address, payment or government-ID data without a policy update.
- **Encryption.** TLS 1.2+ in transit (Supabase, Vercel and Caddy handle this). At rest: Supabase-managed encryption.
- **Private storage.** `floorplans` and `designs` are private; access only via signed URLs with a short expiry (1 h or less; the app uses 1 h)
  or RLS-checked reads. The app stores the file *path* in `"FloorPlan"."ImagePath"`, never a permanent link.
  `avatars` is public on purpose (it is shown in the navbar) and holds only the profile picture.
- **Isolation.** A user must never read another user's rows or files. Test with two accounts before each release.
- **Deletion.** Deleting an account cascades to profile, floor plans and designs (`on delete cascade`).
  Storage objects of that user are removed first, by `delete-user` (admin) and `deleteMyAccount` (self-service), across
  `floorplans`, `designs` and `avatars`; if file removal fails nothing is deleted and the action can be retried.
  Check for orphaned files after changes to either path.
- **Retention.** Detector `output/` files and logs: delete after 30 days. Do not keep uploaded images on the EC2 disk longer than the request needs.
- **No personal data in logs.** Never log passwords, tokens, full emails or image bytes.
- **Processors.** Only Supabase, Vercel, AWS, Resend and Hugging Face (if used). Adding another needs a review of its terms.
- **Subject requests.** Export or delete a user's data within 30 days of a verified request.
