-- Up Migration
-- M4: users/profiles. Introduces a real users table and FK-constrains the user-scoped tables. The
-- app is still effectively single-user, so we seed a stable DEFAULT_USER_ID and — critically — adopt
-- any pre-existing orphan user_ids in reading_progress/annotations BEFORE adding the FKs, so the
-- constraints can't fail on existing data.

CREATE TABLE IF NOT EXISTS users (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  TEXT NOT NULL,
    avatar_color  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stable default profile (matches DEFAULT_USER_ID in the backend).
INSERT INTO users (user_id, display_name, avatar_color)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Reader', '#6c8cff')
ON CONFLICT (user_id) DO NOTHING;

-- Adopt orphan user_ids already present in user-scoped tables.
INSERT INTO users (user_id, display_name)
SELECT DISTINCT user_id, 'Reader ' || left(user_id::text, 8)
FROM reading_progress
WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT user_id FROM users)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO users (user_id, display_name)
SELECT DISTINCT user_id, 'Reader ' || left(user_id::text, 8)
FROM annotations
WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT user_id FROM users)
ON CONFLICT (user_id) DO NOTHING;

-- Now the FKs are safe to add.
ALTER TABLE reading_progress
    ADD CONSTRAINT fk_reading_progress_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE annotations
    ADD CONSTRAINT fk_annotations_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE annotations DROP CONSTRAINT IF EXISTS fk_annotations_user;
ALTER TABLE reading_progress DROP CONSTRAINT IF EXISTS fk_reading_progress_user;
DROP TABLE IF EXISTS users;
