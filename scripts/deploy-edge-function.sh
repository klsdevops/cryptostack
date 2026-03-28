#!/usr/bin/env bash
# CryptoStack — Deploy Edge Function
# Usage: ./scripts/deploy-edge-function.sh YOUR_PROJECT_REF
set -e
PROJECT_REF="${1:-}"
if [ -z "$PROJECT_REF" ]; then
  echo "Usage: $0 <project-ref>"
  echo "  Find your project ref in: Settings → General → Reference ID"
  exit 1
fi
echo "→ Logging in to Supabase..."
supabase login
echo "→ Linking to project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"
echo "→ Deploying edge function 'auth' (JWT verification OFF)..."
supabase functions deploy auth --no-verify-jwt --project-ref "$PROJECT_REF"
echo ""
echo "✓ Done! Open frontend/cryptostack-mobile.html in your browser to get started."
