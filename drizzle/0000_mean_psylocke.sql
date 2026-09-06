CREATE TABLE `activity_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`investment_id` text,
	`actor_type` text DEFAULT 'user' NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`summary` text NOT NULL,
	`previous_snapshot` text,
	`next_snapshot` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`investment_id`) REFERENCES `investments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_activity_logs_user_created` ON `activity_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_activity_logs_investment_created` ON `activity_logs` (`investment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `admin_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`setting_type` text NOT NULL,
	`investment_type` text,
	`investor_category` text,
	`financial_year` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`value_json` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_admin_settings_effective` ON `admin_settings` (`setting_type`,`effective_from`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`investment_id` text,
	`document_name` text NOT NULL,
	`document_type` text NOT NULL,
	`financial_year` text,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`expiry_date` text,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`investment_id`) REFERENCES `investments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_documents_user_investment` ON `documents` (`user_id`,`investment_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_user_name` ON `documents` (`user_id`,`document_name`);--> statement-breakpoint
CREATE TABLE `financial_years` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`is_closed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_financial_years_label` ON `financial_years` (`label`);--> statement-breakpoint
CREATE TABLE `forms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`investment_id` text NOT NULL,
	`form_type` text NOT NULL,
	`financial_year` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`submitted` integer DEFAULT false NOT NULL,
	`submission_date` text,
	`accepted` integer,
	`acknowledgement_number` text,
	`expiry_date` text,
	`document_object_key` text,
	`status` text DEFAULT 'not-required' NOT NULL,
	`remarks` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`investment_id`) REFERENCES `investments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_forms_user_fy_status` ON `forms` (`user_id`,`financial_year`,`status`);--> statement-breakpoint
CREATE TABLE `investment_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_investment_types_code` ON `investment_types` (`code`);--> statement-breakpoint
CREATE TABLE `investments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`issuer_id` text,
	`investment_type_id` text,
	`investment_type` text NOT NULL,
	`investment_name` text NOT NULL,
	`issuer_name_snapshot` text NOT NULL,
	`investment_number` text DEFAULT '' NOT NULL,
	`principal_paise` integer NOT NULL,
	`interest_rate_bps` integer NOT NULL,
	`interest_type` text NOT NULL,
	`payout_frequency` text NOT NULL,
	`investment_date` text NOT NULL,
	`first_payout_date` text,
	`maturity_date` text NOT NULL,
	`expected_maturity_paise` integer,
	`tds_applicable` integer DEFAULT false NOT NULL,
	`expected_tds_rate_bps` integer DEFAULT 0 NOT NULL,
	`pan_linked` integer DEFAULT false NOT NULL,
	`declaration_applicable` integer DEFAULT false NOT NULL,
	`bank_name` text,
	`account_last4` text,
	`payment_mode` text,
	`nominee` text,
	`broker_platform` text,
	`advisor_name` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`financial_year` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issuer_id`) REFERENCES `issuers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`investment_type_id`) REFERENCES `investment_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_investments_user_status` ON `investments` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_investments_user_number` ON `investments` (`user_id`,`investment_number`);--> statement-breakpoint
CREATE INDEX `idx_investments_user_maturity` ON `investments` (`user_id`,`maturity_date`);--> statement-breakpoint
CREATE TABLE `issuers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`issuer_type` text,
	`contact_notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_issuers_name` ON `issuers` (`name`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`scheduled_for` text,
	`read_at` text,
	`related_entity_type` text,
	`related_entity_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_schedule` ON `notifications` (`user_id`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `payout_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`investment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`due_date` text NOT NULL,
	`financial_year` text NOT NULL,
	`gross_interest_paise` integer NOT NULL,
	`expected_tds_rate_bps` integer DEFAULT 0 NOT NULL,
	`expected_tds_paise` integer DEFAULT 0 NOT NULL,
	`expected_net_paise` integer NOT NULL,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`source` text DEFAULT 'generated' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`investment_id`) REFERENCES `investments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payout_schedules_user_due` ON `payout_schedules` (`user_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_payout_schedules_investment_due` ON `payout_schedules` (`investment_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `payout_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`payout_schedule_id` text NOT NULL,
	`investment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`received_amount_paise` integer,
	`received_date` text,
	`actual_tds_paise` integer,
	`bank_account_last4` text,
	`payment_reference` text,
	`proof_object_key` text,
	`status` text NOT NULL,
	`follow_up_date` text,
	`remarks` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`payout_schedule_id`) REFERENCES `payout_schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`investment_id`) REFERENCES `investments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payout_transactions_user_date` ON `payout_transactions` (`user_id`,`received_date`);--> statement-breakpoint
CREATE INDEX `idx_payout_transactions_schedule` ON `payout_transactions` (`payout_schedule_id`);--> statement-breakpoint
CREATE TABLE `tds_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`investment_id` text NOT NULL,
	`payout_schedule_id` text,
	`financial_year` text NOT NULL,
	`gross_interest_paise` integer NOT NULL,
	`expected_tds_rate_bps` integer NOT NULL,
	`expected_tds_paise` integer NOT NULL,
	`actual_tds_paise` integer,
	`tds_reflected` integer,
	`reflected_amount_paise` integer,
	`difference_paise` integer,
	`verification_date` text,
	`certificate_received` integer DEFAULT false NOT NULL,
	`verification_document_key` text,
	`status` text DEFAULT 'not-verified' NOT NULL,
	`remarks` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`investment_id`) REFERENCES `investments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payout_schedule_id`) REFERENCES `payout_schedules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tds_records_user_fy` ON `tds_records` (`user_id`,`financial_year`);--> statement-breakpoint
CREATE INDEX `idx_tds_records_investment` ON `tds_records` (`investment_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_subject` text NOT NULL,
	`full_name` text DEFAULT '' NOT NULL,
	`mobile_masked` text,
	`email` text,
	`pan_ciphertext` text,
	`pan_masked` text,
	`date_of_birth` text,
	`address` text,
	`profile_photo_key` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_users_auth_subject` ON `users` (`auth_subject`);