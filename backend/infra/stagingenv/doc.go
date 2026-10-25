// Package stagingenv holds only a test: it feeds environments rendered by infra/supabase/supabase_target.py to the real
// internal/config loader, so the infra validator cannot drift from the application's own production-staging guards.
// It contains no application behavior and nothing here is imported by a binary.
package stagingenv
