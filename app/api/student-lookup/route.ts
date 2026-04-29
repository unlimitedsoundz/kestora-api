import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Setup the Supabase client securely using environment variables.
// We use the service role key to securely query data from the backend
// without relying on user sessions, perfect for a server-to-server Vapi integration.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; 

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * POST /api/student-lookup
 * Retrieves student information securely for Vapi AI agent.
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

    const { studentId } = body;

    // 2. Validate input - ensure studentId is provided
    if (!studentId) {
      return NextResponse.json(
        { success: false, message: 'studentId is required' },
        { status: 400 }
      );
    }

    // 3. Query the Supabase database
    // We strictly select ONLY the required fields to prevent exposing sensitive data
    // such as passwords, payment details, or internal notes.
    const { data, error } = await supabase
      .from('students')
      .select(`
        full_name,
        student_id,
        programme,
        admission_status,
        tuition_status,
        invoice_issued,
        onboarding_completed
      `)
      .eq('student_id', studentId)
      .single();

    // 4. Handle Supabase query errors
    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { success: false, message: 'Database error', error: error.message },
        { status: 500 }
      );
    }

    // 5. Handle student not found
    if (!data) {
      return NextResponse.json(
        { success: false, message: 'Student not found' },
        { status: 404 }
      );
    }

    // 6. Map the database snake_case fields to camelCase for the API response
    // and return the successful JSON response
    return NextResponse.json(
      {
        success: true,
        student: {
          fullName: data.full_name,
          studentId: data.student_id,
          programme: data.programme,
          admissionStatus: data.admission_status,
          tuitionStatus: data.tuition_status,
          invoiceIssued: data.invoice_issued,
          onboardingCompleted: data.onboarding_completed
        }
      },
      { status: 200 }
    );

  } catch (error) {
    // 6. Catch any unexpected server errors and prevent data leakage
    console.error('Error in student-lookup API:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
