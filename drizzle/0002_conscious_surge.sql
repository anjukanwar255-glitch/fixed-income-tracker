CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text NOT NULL,
	`failure_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_backup_runs_user_created` ON `backup_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'razorpay' NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`provider_subscription_id` text,
	`payload_sha256` text NOT NULL,
	`processing_status` text DEFAULT 'processed' NOT NULL,
	`processed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_billing_events_provider_event` ON `billing_events` (`provider`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `idx_billing_events_subscription` ON `billing_events` (`provider_subscription_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'razorpay' NOT NULL,
	`provider_subscription_id` text,
	`provider_customer_id` text,
	`plan_code` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`current_period_start` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`cancelled_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_subscriptions_provider_id` ON `subscriptions` (`provider_subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_user_status` ON `subscriptions` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `documents` ADD `storage_provider` text DEFAULT 'firebase' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `validation_status` text DEFAULT 'validated' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `validated_at` text;--> statement-breakpoint
ALTER TABLE `investments` ADD `compounding_frequency` text DEFAULT 'quarterly' NOT NULL;--> statement-breakpoint
ALTER TABLE `investments` ADD `day_count_basis` text DEFAULT 'actual-365' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `trial_started_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `trial_ends_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `terms_accepted_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `privacy_accepted_at` text;