// Fallback Supabase settings, used when /api/config.js isn't available
// (for example when you run the site locally or on plain static hosting).
//
// 1. Open your Supabase dashboard -> Project Settings -> API.
// 2. Copy the "anon public" key and paste it below.
//    (The anon key is meant to be public; never put the service_role key here.)
window.__SUPABASE_CONFIG__ = window.__SUPABASE_CONFIG__ || {
  url: "https://ryjoeqsqxjeyehnewwse.supabase.co",
  anonKey: "sb_publishable_-AQkq_v7Kl7HFJFua7eiXw_ESG9tBSD"
};
