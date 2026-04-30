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
      console.log('Incoming student-lookup request body:', body);
    } catch (e) {
      console.error('Failed to parse JSON body:', e);
      return NextResponse.json(
        { success: false, message: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // Support both camelCase (studentId) and snake_case (student_id)
    const rawStudentId = body.studentId || body.student_id;

    // 2. Validate input - ensure studentId is provided
    if (!rawStudentId) {
      console.warn('Missing studentId in request body');
      return NextResponse.json(
        { success: false, message: 'studentId is required' },
        { status: 400 }
      );
    }

    // Normalize student ID: trim and uppercase (format is KCXXXXXXX)
    const studentId = rawStudentId.toString().trim().toUpperCase();
    console.log(`Searching for student with normalized ID: "${studentId}"`);

    // 3. Query the Supabase database
    // We strictly select ONLY the required fields to prevent exposing sensitive data.
    // We query 'profiles' first to ensure we find applicants who only have offer letters
    // but aren't in the 'students' table yet.
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        student_id,
        first_name,
        last_name,
        date_of_birth,
        students (
          admission_status,
          tuition_status,
          invoice_issued,
          onboarding_completed,
          conversation_stage,
          intent_level,
          assigned_advisor,
          payment_deadline,
          last_call_summary,
          visa_stage,
          late_applicant,
          Course (
            *
          )
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

    // 5. Handle student/profile not found
    if (!data || data.length === 0) {
      console.warn(`No record found for student ID: "${studentId}"`);
      return NextResponse.json(
        { success: false, message: 'Student not found' },
        { status: 404 }
      );
    }

    const profile = data[0];
    const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown';

    // Safely extract the student record (if they are enrolled and in the students table)
    const studentRecord = Array.isArray(profile.students) ? profile.students[0] : profile.students;

    // Safely extract the course name from the joined Course table (if they have one)
    const courseObj = studentRecord ? (Array.isArray(studentRecord.Course) ? studentRecord.Course[0] : studentRecord.Course) : null;
    const programmeName = courseObj ? (courseObj.name || courseObj.title || courseObj.course_name || 'Unknown Course') : 'Unknown';

    // 6. Map the database snake_case fields to camelCase for the API response
    // and return the successful JSON response
    console.log(`Successfully found record for: ${fullName} (${studentId})`);
    return NextResponse.json(
      {
        success: true,
        student: {
          fullName: fullName,
          studentId: profile.student_id,
          dateOfBirth: profile.date_of_birth || null,
          programme: programmeName,
          admissionStatus: studentRecord ? studentRecord.admission_status : 'Offer Letter', // Fallback status if not enrolled yet
          tuitionStatus: studentRecord ? studentRecord.tuition_status : null,
          invoiceIssued: studentRecord ? studentRecord.invoice_issued : false,
          onboardingCompleted: studentRecord ? studentRecord.onboarding_completed : false,
          conversationStage: studentRecord ? studentRecord.conversation_stage : null,
          intentLevel: studentRecord ? studentRecord.intent_level : null,
          assignedAdvisor: studentRecord ? studentRecord.assigned_advisor : null,
          paymentDeadline: studentRecord ? studentRecord.payment_deadline : null,
          lastCallSummary: studentRecord ? studentRecord.last_call_summary : null,
          visaStage: studentRecord ? studentRecord.visa_stage : null,
          lateApplicant: studentRecord ? studentRecord.late_applicant : false
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
