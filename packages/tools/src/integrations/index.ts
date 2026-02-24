/**
 * Jarvis Integrations
 *
 * External service integrations for Jarvis agents:
 *   - iMessage (macOS Messages.app via AppleScript + sqlite3)
 *   - Spotify (local AppleScript + Web API)
 *   - Home Assistant (REST API for smart home)
 *   - Cron Scheduler (persistent scheduled tasks)
 *   - Apple Calendar & Reminders (macOS Calendar.app + Reminders.app)
 */

export { IMessageTool, type IMessageConfig } from './imessage.js';
export { SpotifyTool, type SpotifyConfig } from './spotify.js';
export { HomeAssistantTool, type HomeAssistantConfig } from './homeassistant.js';
export { CronSchedulerTool, CronScheduler, type CronSchedulerConfig, type ScheduledJob } from './cron-scheduler.js';
export { AppleCalendarTool, type AppleCalendarConfig } from './apple-calendar.js';
