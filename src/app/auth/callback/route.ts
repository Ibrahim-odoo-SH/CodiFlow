import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Recovery → set-password page (sign-out + PASSWORD_RECOVERY flow)
      if (type === 'recovery') {
        return NextResponse.redirect(new URL('/reset-password', origin))
      }
      // Invite → set-password page (already signed in, just needs to set a password)
      if (type === 'invite') {
        return NextResponse.redirect(new URL('/reset-password?from=invite', origin))
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
