#!/usr/bin/env bash
# Usage: ./scripts/deploy-edge-function.sh YOUR_PROJECT_REF
set -e
PROJECT_REF="${1:-}"
if [ -z "$PROJECT_REF" ]; then
  echo "Usage: $0 <project-ref>  (e.g. abcdefghijklmnop)"
  exit 1
fi
echo "Linking to project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"
echo "Deploying edge function 'auth' (JWT verification OFF)..."
supabase functions deploy auth --no-verify-jwt --project-ref "$PROJECT_REF"
echo "Done! Now update SUPABASE_URL and SUPABASE_ANON in frontend/cryptostack-mobile.html"
