import { createNotificationSoundPlayer } from "./downloadCompletionSound";

// Reuse the bundled chime, with independent throttling from download notifications.
export const playReminderSound = createNotificationSoundPlayer();
