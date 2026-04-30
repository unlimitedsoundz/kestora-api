import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Setup the Supabase client securely using environment variables.
// We use the service role key to securely query data from the backend
// without relying on user sessions, perfect for a server-to-server Vapi integration.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; 

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * GET /api/student-lookup
 * Simple status check to verify the API is online via browser.
 */
export async function GET() {
  // Fetch one sample record to verify column names for debugging
  const { data: sample } = await supabase.from('profiles').select('*').limit(1);

  return NextResponse.json({
    success: true,
    message: 'Kestora Student Lookup API is online',
    timestamp: new Date().toISOString(),
    databaseConnected: !!(supabaseUrl && supabaseKey),
    sampleRecord: sample ? sample[0] : 'No records found'
  });
}

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

    // Support both camelCase (firstName) and snake_case (first_name)
    const rawFirstName = body.firstName || body.first_name || body.name;

    // 2. Validate input - ensure firstName is provided
    if (!rawFirstName) {
      console.warn('Missing firstName in request body');
      return NextResponse.json(
        { success: false, message: 'firstName is required' },
        { status: 400 }
      );
    }

    // 3. Diagnostic: Check if Supabase is properly configured
    if (!supabaseUrl || !supabaseKey) {
      console.error('CRITICAL: Supabase environment variables are missing!');
      return NextResponse.json(
        { success: false, message: 'Server configuration error' },
        { status: 500 }
      );
    }

    const nameInput = rawFirstName.toString().trim();
    const nameParts = nameInput.split(/\s+/);
    const firstNamePart = nameParts[0];
    const lastNamePart = nameParts.length > 1 ? nameParts[nameParts.length - 1] : firstNamePart;

    console.log(`Searching for student with name input: "${nameInput}" (Parts: ${firstNamePart}, ${lastNamePart})`);

    // 4. Query Strategy: Search by first_name or last_name with smart fallbacks
    let query = supabase.from('profiles').select(`
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
      `);

    // If it's a full name (e.g. "Peter Parker"), try matching both
    if (nameParts.length > 1) {
      query = query.and(`first_name.ilike.%${firstNamePart}%,last_name.ilike.%${lastNamePart}%`);
    } else {
      // If it's a single name, search across both columns
      query = query.or(`first_name.ilike.%${nameInput}%,last_name.ilike.%${nameInput}%`);
    }

    const { data, error } = await query.limit(1);

    // 5. Handle Supabase query errors
    if (error) {
      console.error('Supabase error during lookup:', error);
      return NextResponse.json(
        { success: false, message: 'Database error', error: error.message },
        { status: 500 }
      );
    }

    // 5. Handle student not found
    if (!data || data.length === 0) {
      console.warn(`No record found for first name: "${firstName}"`);
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
    console.log(`Successfully found record for: ${fullName} (${profile.student_id})`);
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
