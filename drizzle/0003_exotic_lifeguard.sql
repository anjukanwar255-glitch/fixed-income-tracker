CREATE TABLE `trial_claims` (
	`identity_hash` text PRIMARY KEY NOT NULL,
	`original_user_id` text NOT NULL,
	`claimed_at` text NOT NULL
);
