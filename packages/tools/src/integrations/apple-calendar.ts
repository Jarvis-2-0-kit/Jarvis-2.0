/**
 * Apple Calendar & Reminders Integration
 *
 * Access macOS Calendar.app and Reminders.app via AppleScript/EventKit.
 * Supports: list events, create events, list reminders, create reminders,
 *   search, upcoming view, and calendar management.
 *
 * macOS-only — requires Calendar.app and Reminders.app permissions.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────

export interface AppleCalendarConfig {
  /** Default calendar name for new events */
  readonly defaultCalendar?: string;
  /** Default reminders list name */
  readonly defaultRemindersList?: string;
}

type CalendarAction =
  | 'events_today'
  | 'events_upcoming'
  | 'events_search'
  | 'event_create'
  | 'calendars'
  | 'reminders_list'
  | 'reminder_create'
  | 'reminder_complete'
  | 'reminders_incomplete';

// ─── AppleScript helpers ─────────────────────────────────────────────

function esc(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function osa(script: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not allowed') || msg.includes('not authorized')) {
      throw new Error('Calendar/Reminders access denied. Grant permission in System Preferences → Security & Privacy → Privacy → Calendars/Reminders.');
    }
    throw err;
  }
}

// ─── Calendar functions ──────────────────────────────────────────────

async function getEventsToday(): Promise<string> {
  const script = `
    tell application "Calendar"
      set today to current date
      set todayStart to today - (time of today)
      set todayEnd to todayStart + (1 * days) - 1

      set eventList to ""
      repeat with cal in calendars
        set calName to name of cal
        set calEvents to (every event of cal whose start date ≥ todayStart and start date ≤ todayEnd)
        repeat with evt in calEvents
          set evtStart to start date of evt
          set evtEnd to end date of evt
          set evtSummary to summary of evt
          set evtLoc to ""
          try
            set evtLoc to location of evt
          end try
          set eventList to eventList & calName & " | " & (time string of evtStart) & " - " & (time string of evtEnd) & " | " & evtSummary & " | " & evtLoc & linefeed
        end repeat
      end repeat

      return eventList
    end tell
  `;

  const result = await osa(script);
  if (!result.trim()) {
    return 'No events today.';
  }

  const lines = result.trim().split('\n');
  const formatted = lines.map((line) => {
    const [cal, time, summary, location] = line.split(' | ');
    const loc = location?.trim() ? ` 📍 ${location.trim()}` : '';
    return `  ⏰ ${time?.trim()} — ${summary?.trim()}${loc}\n     📅 ${cal?.trim()}`;
  });

  return `Today's Events (${lines.length}):\n\n${formatted.join('\n\n')}`;
}

async function getUpcomingEvents(days: number = 7): Promise<string> {
  // Validate days is a safe integer to prevent AppleScript injection
  const safeDays = Math.max(1, Math.min(365, Math.floor(Number(days) || 7)));
  const script = `
    tell application "Calendar"
      set today to current date
      set todayStart to today - (time of today)
      set futureEnd to todayStart + (${safeDays} * days)

      set eventList to ""
      repeat with cal in calendars
        set calName to name of cal
        set calEvents to (every event of cal whose start date ≥ todayStart and start date ≤ futureEnd)
        repeat with evt in calEvents
          set evtStart to start date of evt
          set evtEnd to end date of evt
          set evtSummary to summary of evt
          set evtLoc to ""
          try
            set evtLoc to location of evt
          end try
          set eventList to eventList & (date string of evtStart) & " | " & (time string of evtStart) & " - " & (time string of evtEnd) & " | " & evtSummary & " | " & calName & " | " & evtLoc & linefeed
        end repeat
      end repeat

      return eventList
    end tell
  `;

  const result = await osa(script);
  if (!result.trim()) {
    return `No events in the next ${days} days.`;
  }

  const lines = result.trim().split('\n');
  const formatted = lines.map((line) => {
    const [date, time, summary, cal, location] = line.split(' | ');
    const loc = location?.trim() ? ` 📍 ${location.trim()}` : '';
    return `  📆 ${date?.trim()} ${time?.trim()}\n     ${summary?.trim()}${loc} [${cal?.trim()}]`;
  });

  return `Upcoming Events - Next ${days} Days (${lines.length}):\n\n${formatted.join('\n\n')}`;
}

async function searchEvents(query: string, days: number = 30): Promise<string> {
  // Validate days is a safe integer to prevent AppleScript injection
  const safeDays = Math.max(1, Math.min(365, Math.floor(Number(days) || 30)));
  const script = `
    tell application "Calendar"
      set today to current date
      set todayStart to today - (time of today)
      set futureEnd to todayStart + (${safeDays} * days)

      set eventList to ""
      repeat with cal in calendars
        set calName to name of cal
        set calEvents to (every event of cal whose start date ≥ todayStart and start date ≤ futureEnd and summary contains "${esc(query)}")
        repeat with evt in calEvents
          set evtStart to start date of evt
          set evtSummary to summary of evt
          set evtLoc to ""
          try
            set evtLoc to location of evt
          end try
          set eventList to eventList & (date string of evtStart) & " " & (time string of evtStart) & " | " & evtSummary & " | " & calName & " | " & evtLoc & linefeed
        end repeat
      end repeat

      return eventList
    end tell
  `;

  const result = await osa(script);
  if (!result.trim()) {
    return `No events matching "${query}" in the next ${days} days.`;
  }

  const lines = result.trim().split('\n');
  const formatted = lines.map((line) => {
    const [datetime, summary, cal, location] = line.split(' | ');
    const loc = location?.trim() ? ` 📍 ${location.trim()}` : '';
    return `  📆 ${datetime?.trim()} — ${summary?.trim()}${loc} [${cal?.trim()}]`;
  });

  return `Search results for "${query}" (${lines.length} events):\n\n${formatted.join('\n')}`;
}

async function createEvent(
  title: string,
  startDate: string,
  endDate: string,
  calendar?: string,
  location?: string,
  notes?: string,
  allDay?: boolean,
): Promise<string> {
  const calClause = calendar
    ? `set targetCal to calendar "${esc(calendar)}"`
    : 'set targetCal to first calendar';

  const locationClause = location ? `set location of newEvent to "${esc(location)}"` : '';
  const notesClause = notes ? `set description of newEvent to "${esc(notes)}"` : '';

  // Parse ISO dates for AppleScript
  const startJS = new Date(startDate);
  const endJS = new Date(endDate);

  const startAS = `date "${startJS.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${startJS.toLocaleTimeString('en-US')}"`;
  const endAS = `date "${endJS.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${endJS.toLocaleTimeString('en-US')}"`;

  const script = `
    tell application "Calendar"
      ${calClause}
      set newEvent to make new event at end of events of targetCal with properties {summary:"${esc(title)}", start date:${startAS}, end date:${endAS}${allDay ? ', allday event:true' : ''}}
      ${locationClause}
      ${notesClause}
      return "created"
    end tell
  `;

  await osa(script);
  const startFormatted = startJS.toLocaleString();
  return `✅ Event created: "${title}" on ${startFormatted}${location ? ` at ${location}` : ''}`;
}

async function listCalendars(): Promise<string> {
  const script = `
    tell application "Calendar"
      set calList to ""
      repeat with cal in calendars
        set calList to calList & name of cal & " | " & (color of cal as string) & linefeed
      end repeat
      return calList
    end tell
  `;

  const result = await osa(script);
  if (!result.trim()) return 'No calendars found.';

  const lines = result.trim().split('\n');
  const formatted = lines.map((line, i) => {
    const [name] = line.split(' | ');
    return `  ${i + 1}. 📅 ${name?.trim()}`;
  });

  return `Calendars (${lines.length}):\n\n${formatted.join('\n')}`;
}

// ─── Reminders functions ─────────────────────────────────────────────

async function getIncompleteReminders(listName?: string): Promise<string> {
  const listClause = listName
    ? `set targetList to list "${esc(listName)}"`
    : 'set targetList to default list';

  const script = `
    tell application "Reminders"
      ${listClause}
      set reminderList to ""
      set incompleteReminders to (every reminder of targetList whose completed is false)
      repeat with rem in incompleteReminders
        set remName to name of rem
        set remDue to ""
        try
          set remDue to due date of rem as string
        end try
        set remPri to priority of rem
        set reminderList to reminderList & remName & " | " & remDue & " | " & remPri & linefeed
      end repeat
      return reminderList
    end tell
  `;

  const result = await osa(script);
  if (!result.trim()) return 'No incomplete reminders.';

  const lines = result.trim().split('\n');
  const formatted = lines.map((line) => {
    const [name, due, priority] = line.split(' | ');
    const dueStr = due?.trim() ? ` 📅 ${due.trim()}` : '';
    const priStr = priority && parseInt(priority) > 0 ? ` ⚡${priority.trim()}` : '';
    return `  ☐ ${name?.trim()}${dueStr}${priStr}`;
  });

  return `Reminders (${lines.length} incomplete):\n\n${formatted.join('\n')}`;
}

async function getReminderLists(): Promise<string> {
  const script = `
    tell application "Reminders"
      set listOutput to ""
      repeat with reminderList in lists
        set listName to name of reminderList
        set incomplete to count of (every reminder of reminderList whose completed is false)
        set listOutput to listOutput & listName & " | " & incomplete & linefeed
      end repeat
      return listOutput
    end tell
  `;

  const result = await osa(script);
  if (!result.trim()) return 'No reminder lists found.';

  const lines = result.trim().split('\n');
  const formatted = lines.map((line) => {
    const [name, count] = line.split(' | ');
    return `  📋 ${name?.trim()} (${count?.trim() ?? 0} incomplete)`;
  });

  return `Reminder Lists (${lines.length}):\n\n${formatted.join('\n')}`;
}

async function createReminder(
  title: string,
  listName?: string,
  dueDate?: string,
  notes?: string,
  priority?: number,
): Promise<string> {
  const listClause = listName
    ? `set targetList to list "${esc(listName)}"`
    : 'set targetList to default list';

  let properties = `{name:"${esc(title)}"`;
  if (notes) properties += `, body:"${esc(notes)}"`;
  if (priority) properties += `, priority:${priority}`;
  properties += '}';

  let dueClause = '';
  if (dueDate) {
    const dueJS = new Date(dueDate);
    const dueAS = `date "${dueJS.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${dueJS.toLocaleTimeString('en-US')}"`;
    dueClause = `set due date of newReminder to ${dueAS}`;
  }

  const script = `
    tell application "Reminders"
      ${listClause}
      set newReminder to make new reminder at end of reminders of targetList with properties ${properties}
      ${dueClause}
      return "created"
    end tell
  `;

  await osa(script);
  const dueStr = dueDate ? ` (due: ${new Date(dueDate).toLocaleString()})` : '';
  return `✅ Reminder created: "${title}"${dueStr}${listName ? ` in "${listName}"` : ''}`;
}

async function completeReminder(title: string, listName?: string): Promise<string> {
  const listClause = listName
    ? `set targetList to list "${esc(listName)}"`
    : 'set targetList to default list';

  const script = `
    tell application "Reminders"
      ${listClause}
      set matchingReminders to (every reminder of targetList whose name contains "${esc(title)}" and completed is false)
      if (count of matchingReminders) > 0 then
        set completed of (item 1 of matchingReminders) to true
        return "completed: " & name of (item 1 of matchingReminders)
      else
        return "not_found"
      end if
    end tell
  `;

  const result = await osa(script);
  if (result.includes('not_found')) {
    return `Reminder "${title}" not found or already completed.`;
  }
  return `✅ ${result}`;
}

// ─── Tool class ──────────────────────────────────────────────────────

export class AppleCalendarTool implements AgentTool {
  private config: AppleCalendarConfig;

  definition = {
    name: 'calendar',
    description: 'Access Apple Calendar and Reminders on macOS. Actions: events_today (today\'s events), events_upcoming (next N days), events_search (search events), event_create (create event), calendars (list calendars), reminders_list (show reminder lists), reminders_incomplete (incomplete reminders), reminder_create (create reminder), reminder_complete (mark reminder done).',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['events_today', 'events_upcoming', 'events_search', 'event_create', 'calendars', 'reminders_list', 'reminders_incomplete', 'reminder_create', 'reminder_complete'],
          description: 'Action to perform',
        },
        // Event parameters
        title: { type: 'string', description: 'Event/reminder title' },
        start_date: { type: 'string', description: 'ISO start datetime (for event_create)' },
        end_date: { type: 'string', description: 'ISO end datetime (for event_create)' },
        calendar: { type: 'string', description: 'Calendar name (for event_create)' },
        location: { type: 'string', description: 'Event location' },
        notes: { type: 'string', description: 'Notes/description' },
        all_day: { type: 'boolean', description: 'All-day event (default: false)' },
        // Search/upcoming params
        query: { type: 'string', description: 'Search query (for events_search)' },
        days: { type: 'number', description: 'Number of days to look ahead (default: 7)' },
        // Reminder parameters
        list_name: { type: 'string', description: 'Reminders list name' },
        due_date: { type: 'string', description: 'ISO due date for reminder' },
        priority: { type: 'number', description: 'Reminder priority (0=none, 1=high, 5=medium, 9=low)' },
      },
      required: ['action'],
    },
  };

  constructor(config: AppleCalendarConfig = {}) {
    this.config = config;
  }

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    if (process.platform !== 'darwin') {
      return createErrorResult('Calendar tool is macOS-only.');
    }

    const action = params['action'] as CalendarAction;

    try {
      switch (action) {
        case 'events_today':
          return createToolResult(await getEventsToday());

        case 'events_upcoming': {
          const days = (params['days'] as number) || 7;
          return createToolResult(await getUpcomingEvents(days));
        }

        case 'events_search': {
          const query = params['query'] as string;
          if (!query) return createErrorResult('events_search requires "query" parameter.');
          const days = (params['days'] as number) || 30;
          return createToolResult(await searchEvents(query, days));
        }

        case 'event_create': {
          const title = params['title'] as string;
          const startDate = params['start_date'] as string;
          const endDate = params['end_date'] as string;
          if (!title || !startDate || !endDate) {
            return createErrorResult('event_create requires title, start_date, and end_date.');
          }
          return createToolResult(await createEvent(
            title, startDate, endDate,
            (params['calendar'] as string) ?? this.config.defaultCalendar,
            params['location'] as string,
            params['notes'] as string,
            params['all_day'] as boolean,
          ));
        }

        case 'calendars':
          return createToolResult(await listCalendars());

        case 'reminders_list':
          return createToolResult(await getReminderLists());

        case 'reminders_incomplete': {
          const listName = (params['list_name'] as string) ?? this.config.defaultRemindersList;
          return createToolResult(await getIncompleteReminders(listName));
        }

        case 'reminder_create': {
          const title = params['title'] as string;
          if (!title) return createErrorResult('reminder_create requires "title" parameter.');
          return createToolResult(await createReminder(
            title,
            (params['list_name'] as string) ?? this.config.defaultRemindersList,
            params['due_date'] as string,
            params['notes'] as string,
            params['priority'] as number,
          ));
        }

        case 'reminder_complete': {
          const title = params['title'] as string;
          if (!title) return createErrorResult('reminder_complete requires "title" parameter.');
          return createToolResult(await completeReminder(
            title,
            (params['list_name'] as string) ?? this.config.defaultRemindersList,
          ));
        }

        default:
          return createErrorResult(`Unknown action: ${action}`);
      }
    } catch (err) {
      return createErrorResult(`Calendar error: ${(err as Error).message}`);
    }
  }
}
