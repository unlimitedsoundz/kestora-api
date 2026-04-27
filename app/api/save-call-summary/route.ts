import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Setup the Supabase client securely using environment variables.
// Using the service role key to securely insert data from the backend.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; 

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * POST /api/save-call-summary
 * Saves Vapi AI call summaries into the Supabase database.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Parse the incoming JSON request body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json(
        { success: false, message: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { 
      student_id, 
      caller_name, 
      call_summary, 
      caller_concern, 
      next_action 
    } = body;

    // 2. Validate input - ensure required fields are provided
    if (!student_id || !caller_name || !call_summary) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'student_id, caller_name, and call_summary are required fields' 
        },
        { status: 400 }
      );
    }

    // 3. Insert the call log into the Supabase database
    const { error } = await supabase
      .from('call_logs')
      .insert([
        {
          student_id,
          caller_name,
          call_summary,
          caller_concern: caller_concern || null,
          next_action: next_action || null
        }
      ]);

    // 4. Handle Supabase database errors
    if (error) {
      console.error('Supabase error inserting call log:', error);
      return NextResponse.json(
        { success: false, message: 'Database error', error: error.message },
        { status: 500 }
      );
    }

    // 5. Return JSON success response
    return NextResponse.json(
      { success: true, message: 'Call summary saved successfully' },
      { status: 200 }
    );

  } catch (error) {
    // 6. Catch any unexpected server errors
    console.error('Error in save-call-summary API:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
