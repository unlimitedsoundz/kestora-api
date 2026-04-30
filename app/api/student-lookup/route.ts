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
  return NextResponse.json({
    success: true,
    message: 'Kestora Student Lookup API is online',
    timestamp: new Date().toISOString(),
    databaseConnected: !!(supabaseUrl && supabaseKey)
  });
}

/**
 * POST /api/student-lookup
 * Retrieves student information securely for Vapi AI agent.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Parse the incoming request body with fallback
    let body: any = {};
    const rawBody = await req.text();
    console.log('Raw incoming request body:', rawBody);

    try {
      if (rawBody) {
        body = JSON.parse(rawBody);
      }
    } catch (e) {
      console.error('Failed to parse JSON body:', e);
      return NextResponse.json(
        { found: false, message: 'Invalid JSON body', received: rawBody.substring(0, 100) },
        { status: 400 }
      );
    }

    // 2. Identify the input - support both Direct Tool Call and Webhook formats
    // Try to find the arguments in the nested Vapi message structure first
    const toolCallArgs = body?.message?.toolCalls?.[0]?.function?.arguments;
    const parsedArgs = typeof toolCallArgs === 'string' ? JSON.parse(toolCallArgs) : (toolCallArgs || {});

    const input = (
      parsedArgs.firstName ||
      parsedArgs.first_name ||
      parsedArgs.name ||
      parsedArgs.studentId ||
      parsedArgs.student_id ||
      parsedArgs.id ||
      body.firstName || 
      body.first_name || 
      body.name || 
      body.studentId || 
      body.student_id || 
      body.id ||
      body.search ||
      ""
    ).toString().trim();

    if (!input) {
      console.warn('No search input found in body. Format might be unexpected:', body);
      return NextResponse.json({ 
        found: false, 
        message: 'Search input (name or studentId) is required',
        receivedBody: body // Return the body so we can see it in Vapi logs
      }, { status: 400 });
    }

    // Diagnostic: Check if Supabase is properly configured
    if (!supabaseUrl || !supabaseKey) {
      console.error('CRITICAL: Supabase environment variables are missing!');
      return NextResponse.json({ success: false, message: 'Server configuration error' }, { status: 500 });
    }

    // Determine if input is a Student ID (starts with KC or SYK) or a Name
    const isStudentId = /^KC|^SYK/i.test(input);
    
    // 3. Query Strategy
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
          Course (*)
        )
      `);

    if (isStudentId) {
      // Normalize ID (trim and uppercase)
      const normalizedId = input.toUpperCase();
      console.log(`Searching by Student ID: "${normalizedId}"`);
      query = query.eq('student_id', normalizedId);
    } else {
      // Handle Name Search
      const cleanedName = input.length > 5 && input.includes(' ') ? input.replace(/(?:^|\s)([a-zA-Z])(?:\s|\.|$)/g, '$1') : input;
      const nameParts = cleanedName.split(/\s+/);
      const firstNamePart = nameParts[0];
      const lastNamePart = nameParts.length > 1 ? nameParts[nameParts.length - 1] : firstNamePart;
      
      console.log(`Searching by Name: "${input}" (Cleaned: ${cleanedName})`);
      query = query.or(`first_name.ilike.%${cleanedName}%,last_name.ilike.%${cleanedName}%,first_name.ilike.%${firstNamePart}%,last_name.ilike.%${lastNamePart}%`);
    }

    const { data, error } = await query.limit(1);

    // 4. Handle Supabase query errors
    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ success: false, message: 'Database error' }, { status: 500 });
    }

    // 5. Handle student not found with a structured JSON (Vapi Best Practice)
    if (!data || data.length === 0) {
      console.warn(`No record found for: "${input}"`);
      return NextResponse.json({
        found: false,
        message: 'No student record found'
      }, { status: 200 }); // Using 200 ensures Vapi receives the "found: false" message correctly
    }

    const profile = data[0];
    const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown';
    const studentRecord = Array.isArray(profile.students) ? profile.students[0] : profile.students;
    const courseObj = studentRecord ? (Array.isArray(studentRecord.Course) ? studentRecord.Course[0] : studentRecord.Course) : null;
    const programmeName = courseObj ? (courseObj.name || courseObj.title || courseObj.course_name || 'Unknown Course') : 'Unknown';

    // 6. Final Optimized Response following the Vapi Webhook Guide
    const status = studentRecord ? studentRecord.admission_status : 'Offer Letter';
    const summary = `${fullName} has been found. Status: ${status}. Programme: ${programmeName}.`;
    
    console.log(`Successfully found record for: ${fullName} (${profile.student_id})`);
    
    // Extract toolCallId for the mandatory Vapi response format
    const toolCallId = body?.message?.toolCalls?.[0]?.id;

    const result = {
      found: true,
      message: summary,
      student: {
        studentId: profile.student_id,
        fullName: fullName,
        dateOfBirth: profile.date_of_birth || null,
        program: programmeName,
        status: status,
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
    };

    // If it's a Vapi Tool Call, we MUST return the toolCallId
    if (toolCallId) {
      return NextResponse.json({
        toolCallId,
        result
      }, { status: 200 });
    }

    // Fallback for direct API calls
    return NextResponse.json(result, { status: 200 });

  } catch (error) {
    // 6. Catch any unexpected server errors and prevent data leakage
    console.error('Error in student-lookup API:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
