import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Setup the Supabase client securely using environment variables.
// Using the service role key to securely insert data from the backend.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; 

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * GET /api/save-call-summary
 * Simple status check to verify the API is online via browser.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Kestora Save Call Summary API is online',
    timestamp: new Date().toISOString(),
    databaseConnected: !!(supabaseUrl && supabaseKey)
  });
}

/**
 * POST /api/save-call-summary
 * Saves Vapi AI call summaries into the Supabase database.
 * Supports both direct JSON posts and Vapi's nested tool-call format.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Parse the incoming JSON request body with logging for debugging
    const rawBody = await req.text();
    console.log('Incoming save-call-summary request body:', rawBody);
    
    let body: any = {};
    try {
      if (rawBody) {
        body = JSON.parse(rawBody);
      }
    } catch (e) {
      console.error('Failed to parse JSON body:', e);
      return NextResponse.json(
        { success: false, message: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // 2. Extract arguments - support both Flat (Direct) and Nested (Vapi Tool) formats
    // If it's a Vapi message, the parameters are inside toolCalls[0].function.arguments
    const toolCallArgs = body?.message?.toolCalls?.[0]?.function?.arguments;
    const parsedArgs = typeof toolCallArgs === 'string' ? JSON.parse(toolCallArgs) : (toolCallArgs || {});

    // Collect fields from either the parsed Vapi args or the top-level body (for direct calls)
    const student_id = parsedArgs.student_id || parsedArgs.studentId || body.student_id || body.studentId;
    const caller_name = parsedArgs.caller_name || parsedArgs.callerName || body.caller_name || body.callerName;
    const call_summary = parsedArgs.call_summary || parsedArgs.callSummary || body.call_summary || body.callSummary;
    const caller_concern = parsedArgs.caller_concern || parsedArgs.callerConcern || body.caller_concern || body.callerConcern || null;
    const next_action = parsedArgs.next_action || parsedArgs.nextAction || body.next_action || body.nextAction || null;

    // 3. Validate input - ensure required fields are provided
    if (!student_id || !caller_name || !call_summary) {
      console.warn('Missing required fields for call summary:', { student_id, caller_name, call_summary });
      return NextResponse.json(
        { 
          success: false, 
          message: 'student_id, caller_name, and call_summary are required fields',
          received: { student_id, caller_name, call_summary }
        },
        { status: 400 }
      );
    }

    // 3. Normalize Student ID (ensure it matches DB format like KC123)
    const normalizedId = student_id.trim().toUpperCase();

    // 4. Insert the call log into the Supabase 'call_logs' table
    const { error: logError } = await supabase
      .from('call_logs')
      .insert([
        {
          student_id: normalizedId,
          caller_name,
          call_summary,
          caller_concern,
          next_action
        }
      ]);

    if (logError) {
      console.error('Supabase error inserting into call_logs:', logError);
      return NextResponse.json(
        { success: false, message: 'Database error saving to call_logs', error: logError.message },
        { status: 500 }
      );
    }

    // 5. ALSO update the main student record with the latest summary
    // This ensures the next time the student is looked up, the AI sees the latest context.
    const { error: studentUpdateError } = await supabase
      .from('students')
      .update({ last_call_summary: call_summary })
      .eq('student_id', normalizedId);

    if (studentUpdateError) {
      console.warn('Could not update last_call_summary in students table:', studentUpdateError.message);
      // We don't return an error here because the main log was already saved successfully.
    }

    console.log(`Successfully saved call summary for student ${normalizedId}`);

    // 6. Return response in the format Vapi expects if it was a tool call
    const toolCallId = body?.message?.toolCalls?.[0]?.id;
    const result = { success: true, message: 'Call summary saved successfully' };

    if (toolCallId) {
      return NextResponse.json({
        results: [
          {
            toolCallId,
            result
          }
        ]
      }, { status: 200 });
    }

    // Fallback for direct API calls
    return NextResponse.json(result, { status: 200 });

  } catch (error) {
    // 7. Catch any unexpected server errors
    console.error('Error in save-call-summary API:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
