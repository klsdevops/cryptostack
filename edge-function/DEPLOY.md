# Edge Function Deployment

## Retrieve the live source

The production edge function (v19) is deployed at:
`https://jmyarnvpuwethwhucxvp.supabase.co/functions/v1/auth`

To download the source via CLI:
```bash
supabase link --project-ref jmyarnvpuwethwhucxvp
supabase functions download auth
```

## Deploy to a new project

1. Copy `index.ts` to your new project's `supabase/functions/auth/index.ts`
2. Run: `supabase functions deploy auth --no-verify-jwt`

## Environment variables (set automatically by Supabase)

- `SUPABASE_URL` — your project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (never expose this in frontend)

## Key design notes

- `verify_jwt: false` — the function implements its own session auth
- Uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS (no RLS policies needed)
- All DB operations go through the edge function — frontend only has the anon key
