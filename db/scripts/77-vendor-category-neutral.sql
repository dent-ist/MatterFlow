-- 77-vendor-category-neutral.sql
-- Purpose: Vendors (epic #1373, issue #1385). A vendor's category is now PREFERRED, NEUTRAL or BLACKLISTED (owner decision). NEUTRAL is a plain, unflagged
--   category and the default for a new vendor.
-- Owner: Vendors.
-- Notes:
--   * Script 73 allowed only PREFERRED and BLACKLISTED and gave the column no default. This script replaces CK_Vendor_Category with a check that also allows
--     NEUTRAL and adds DF_Vendor_Category (NEUTRAL), so an insert that does not name a category gets NEUTRAL.
--   * No data change: every existing vendor keeps its category (the demo vendors stay PREFERRED or BLACKLISTED). The application also treats a missing
--     category on create as NEUTRAL.
--   * No new table, so report-access and grants are unchanged.

ALTER TABLE dbo.Vendor DROP CONSTRAINT CK_Vendor_Category;
GO

ALTER TABLE dbo.Vendor ADD CONSTRAINT CK_Vendor_Category CHECK (CategoryCode IN ('PREFERRED', 'NEUTRAL', 'BLACKLISTED'));
GO

ALTER TABLE dbo.Vendor ADD CONSTRAINT DF_Vendor_Category DEFAULT 'NEUTRAL' FOR CategoryCode;
GO
