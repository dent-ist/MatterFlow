-- 75-vendor-option-starter.sql
-- Purpose: Starter Services and Areas for vendors (epic #1373, issue #1377). Script 73 created dbo.VendorServiceOption and dbo.VendorAreaOption empty; this seeds the firm's
--   usual values so the vendor form is useful from the first day.
--   Services: eDiscovery, Forensic, Review, Custom development, Forensic accounting, ITAR. Areas: US, EU, Asia (in this order).
-- Owner: Vendors (admin lists).
-- Notes:
--   * Idempotent: each list gets its rows only while it is empty, so an administrator's own list (renamed, reordered, deleted or added items) is never changed by a re-run.
--   * The administrator can rename, reorder, deactivate and delete them on Administration > Lists like any other item (a used item is deactivated, not deleted).

IF NOT EXISTS (SELECT 1 FROM dbo.VendorServiceOption)
BEGIN
  INSERT dbo.VendorServiceOption (Name, SortOrder, IsActive)
  VALUES (N'eDiscovery', 1, 1), (N'Forensic', 2, 1), (N'Review', 3, 1), (N'Custom development', 4, 1), (N'Forensic accounting', 5, 1), (N'ITAR', 6, 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.VendorAreaOption)
BEGIN
  INSERT dbo.VendorAreaOption (Name, SortOrder, IsActive)
  VALUES (N'US', 1, 1), (N'EU', 2, 1), (N'Asia', 3, 1);
END
GO
