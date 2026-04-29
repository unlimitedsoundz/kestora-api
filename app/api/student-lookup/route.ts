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
    // We strictly select ONLY the required fields to prevent exposing sensitive data.
    // We join the profiles table to get the first and last name.
    const { data, error } = await supabase
      .from('students')
      .select(`
        student_id,
        program_id,
        admission_status,
        tuition_status,
        invoice_issued,
        onboarding_completed,
        profiles (
          first_name,
          last_name
        ),
        Course (
          *
        )
      `)
      .eq('student_id', studentId)
      .limit(1);

    // 4. Handle Supabase query errors
    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { success: false, message: 'Database error', error: error.message },
        { status: 500 }
      );
    }

    // 5. Handle student not found
    if (!data || data.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Student not found' },
        { status: 404 }
      );
    }

    const studentData = data[0];

    // Safely extract the name from the joined profiles table
    const profile = Array.isArray(studentData.profiles) ? studentData.profiles[0] : studentData.profiles;
    const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : 'Unknown';

    // Safely extract the course name from the joined Course table
    const courseObj = Array.isArray(studentData.Course) ? studentData.Course[0] : studentData.Course;
    // Try common column names for course title (name, title, course_name)
    const programmeName = courseObj ? (courseObj.name || courseObj.title || courseObj.course_name || 'Unknown Course') : 'Unknown';

    // 6. Map the database snake_case fields to camelCase for the API response
    // and return the successful JSON response
    return NextResponse.json(
      {
        success: true,
        student: {
          fullName: fullName,
          studentId: studentData.student_id,
          programme: programmeName,
          admissionStatus: studentData.admission_status,
          tuitionStatus: studentData.tuition_status,
          invoiceIssued: studentData.invoice_issued,
          onboardingCompleted: studentData.onboarding_completed
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
