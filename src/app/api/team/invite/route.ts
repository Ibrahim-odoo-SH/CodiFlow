import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const SITE_URL = 'https://codiflow.cottondivision.com'

export async function POST(request: NextRequest) {
  // Verify the caller is authenticated and is an admin
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: caller } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  if (caller?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can invite team members' }, { status: 403 })
  }

  const { email, full_name, role } = await request.json()

  if (!email || !full_name || !role) {
    return NextResponse.json({ error: 'email, full_name, and role are required' }, { status: 400 })
  }
  if (!email.endsWith('@cottondivision.com')) {
    return NextResponse.json({ error: 'Only @cottondivision.com emails are allowed' }, { status: 400 })
  }

  const cleanEmail = email.trim().toLowerCase()
  const cleanName = full_name.trim()

  // Use service role for admin operations (bypass RLS)
  const admin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // --- Try to invite as a new user first ---
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    cleanEmail,
    { data: { full_name: cleanName } }
  )

  // --- Handle "already registered" gracefully ---
  if (inviteError) {
    const alreadyExists =
      inviteError.message.toLowerCase().includes('already been registered') ||
      inviteError.message.toLowerCase().includes('already registered') ||
      inviteError.message.toLowerCase().includes('user already exists')

    if (!alreadyExists) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 })
    }

    // User exists in auth.users — find their profile, update it, and send a password reset
    const { data: existingProfile, error: lookupErr } = await admin
      .from('profiles')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle()

    let profile = existingProfile

    if (existingProfile) {
      // Update name and role in place
      const { data: updated } = await admin
        .from('profiles')
        .update({ full_name: cleanName, role, is_active: true })
        .eq('id', existingProfile.id)
        .select()
        .single()
      if (updated) profile = updated
    }

    // Send a password-reset email so the user can set (or reset) their password
    // We use the anon-key client which triggers the Supabase mailer
    const anonClient = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    await anonClient.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${SITE_URL}/auth/callback?type=recovery`,
    })

    return NextResponse.json({
      profile,
      alreadyExisted: true,
      message: `${cleanEmail} already has an account. A password-reset email has been sent so they can set their password and sign in.`,
    })
  }

  // --- New user invited successfully — upsert profile ---
  const userId = inviteData.user.id

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .upsert(
      { id: userId, email: cleanEmail, full_name: cleanName, role, is_active: true },
      { onConflict: 'id' }
    )
    .select()
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ profile })
}
