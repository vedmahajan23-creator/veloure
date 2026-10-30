# Veloura

Veloura is a Vite static frontend with Supabase Auth, Postgres, and Storage for studio-managed templates. Visitors can browse published designs and make/download their own images without signing in.

## Set up Supabase

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor. This creates the templates table, public artwork reads, and admin-only write policies.
3. In **Authentication → Users**, create the studio admin account. Open its user record and set this **app metadata** value:

   ```json
   { "is_admin": true }
   ```

   App metadata is controlled by Supabase administrators. Do not put an admin flag in user-editable metadata.
4. In Supabase **Project Settings → API**, copy the project URL and the publishable (or legacy anon) key.

## Configure and run locally

1. Copy `.env.example` to `.env`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Supabase project values.
3. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

The Supabase publishable/anon key is intended for browser use and is protected by Row Level Security. **Never add a service-role key, database password, or admin password to `.env`, frontend code, or a Vercel client-side environment variable.**

## Deploy to Vercel

1. Push the project to a Git provider and import it into Vercel.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Vercel project's environment variables.
3. Deploy with the included Vite build configuration (`npm run build`, output folder `dist`).
4. In Supabase **Authentication → URL Configuration**, set the production site URL and add the Vercel preview/production URLs you use to the redirect allow list.

The public template gallery is shared across all visitors. Template artwork is stored in the `template-artwork` public-read bucket; insert/update/delete permissions are restricted to authenticated users with trusted `app_metadata.is_admin = true`. Only published templates are visible to visitors.

## Browser-only user photos

Visitor-uploaded photos remain in the visitor's browser. The app does not upload those personal photos to Supabase. Template artwork and names/descriptions are stored remotely so all visitors can see published templates.
