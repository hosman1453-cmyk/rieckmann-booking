-- Booking page (anon) may read active Hausbesuch schedules
DROP POLICY IF EXISTS hausbesuch_settings_public_read ON hausbesuch_settings;
CREATE POLICY hausbesuch_settings_public_read ON hausbesuch_settings
  FOR SELECT TO anon, authenticated
  USING (is_active = true);
