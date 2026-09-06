-- Phone sign-in replaces the previous identity provider.
-- `mobile_masked` held a display-only value; the app now stores the full E.164
-- number and masks it at render, so the old column is dropped rather than
-- renamed to guarantee no masked string is read back as a real number.
ALTER TABLE `users` DROP COLUMN `mobile_masked`;--> statement-breakpoint
ALTER TABLE `users` ADD `mobile_e164` text;
