-- Therapist calendar color (admin color picker)
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS color TEXT;

-- Hausbesuch schedule per therapist / region / weekday
CREATE TABLE IF NOT EXISTS hausbesuch_settings (
  id BIGSERIAL PRIMARY KEY,
  therapist_id BIGINT NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  region TEXT NOT NULL CHECK (region IN ('peterhausen', 'allensbach', 'reichenau')),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '17:00',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (therapist_id, region, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_hausbesuch_therapist ON hausbesuch_settings(therapist_id);

ALTER TABLE hausbesuch_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hausbesuch_settings_authenticated_all ON hausbesuch_settings;
CREATE POLICY hausbesuch_settings_authenticated_all ON hausbesuch_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
