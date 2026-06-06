import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Service role client (server-side only)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

export async function POST(request: Request) {
  try {
    // 1. Auth token'ı al (admin panelden gelen)
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized - no token' }, 
        { status: 401 }
      )
    }

    // 2. Token'ı doğrula (anon key ile)
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - invalid token' }, 
        { status: 401 }
      )
    }

    // 3. Dosya adını al
    const { fileName } = await request.json()
    
    if (!fileName) {
      return NextResponse.json(
        { error: 'fileName required' }, 
        { status: 400 }
      )
    }

    // 4. Signed URL oluştur (30 saniye)
    const { data, error } = await supabaseAdmin.storage
      .from('prescriptions')
      .createSignedUrl(fileName, 30)

    if (error) {
      console.error('Signed URL error:', error)
      return NextResponse.json(
        { error: error.message }, 
        { status: 500 }
      )
    }

    return NextResponse.json({ signedUrl: data.signedUrl })
    
  } catch (err) {
    console.error('API error:', err)
    return NextResponse.json(
      { error: 'Internal error' }, 
      { status: 500 }
    )
  }
}