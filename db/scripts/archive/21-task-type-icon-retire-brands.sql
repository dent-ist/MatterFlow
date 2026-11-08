-- 21-task-type-icon-retire-brands.sql
-- Purpose: UX review round 4. The Task Type icon library no longer contains trademarked third-party brand logos (brand-*) or the near
--   duplicate icons "server-2" and "fingerprint-scan" (contracts/task-type-icons.json, 300 icons, generic replacements added). Task Types that
--   still point at a removed key are moved to the generic replacement so every stored IconKey stays in the allow-list.
-- Owner: Configuration.
-- Notes:
--   * Data-only change; the CHECK from script 19 (well-formed ids) is unchanged. Task Types never used these keys in the shipped seeds.
--   * Never edit this mapping after merge; add a new script for further retirements.

UPDATE dbo.TaskType SET IconKey = m.NewKey
FROM dbo.TaskType t
JOIN (VALUES
  ('brand-windows', 'app-window'),
  ('brand-apple', 'devices'),
  ('brand-android', 'device-mobile-code'),
  ('brand-aws', 'cloud-data-connection'),
  ('brand-azure', 'cloud-network'),
  ('brand-google-drive', 'cloud-search'),
  ('brand-onedrive', 'cloud-share'),
  ('brand-office', 'file-type-doc'),
  ('brand-dropbox', 'folder-cog'),
  ('brand-slack', 'message-2'),
  ('brand-teams', 'device-computer-camera'),
  ('brand-skype', 'phone-incoming'),
  ('brand-zoom', 'device-desktop-share'),
  ('brand-whatsapp', 'message-share'),
  ('brand-telegram', 'mail-share'),
  ('brand-signal', 'message-report'),
  ('brand-discord', 'headphones'),
  ('brand-wechat', 'message-code'),
  ('brand-gmail', 'mail-opened'),
  ('brand-facebook', 'social'),
  ('brand-linkedin', 'world-www'),
  ('brand-instagram', 'share'),
  ('brand-x', 'broadcast'),
  ('server-2', 'server'),
  ('fingerprint-scan', 'hash')
) AS m (OldKey, NewKey) ON m.OldKey = t.IconKey;
GO

-- Safety net for any other value outside the retired list that is no longer in the library.
UPDATE dbo.TaskType SET IconKey = 'file-text' WHERE IconKey LIKE 'brand-%';
GO
