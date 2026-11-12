-- 70-matter-category-starter.sql
-- Purpose: Starter Matter Categories (epic #1368, issue #1380). Script 68 created dbo.MatterCategory empty; this seeds the firm's usual categories so the Matter
--   Category dropdown is useful from the first day: Litigation, Investigation, Regulatory Inquiry, Arbitration, Second Request, Internal Review, Other (in this order).
-- Owner: Configuration (admin lists).
-- Notes:
--   * Idempotent: the rows are added only while the list is empty, so an administrator's own list (renamed, reordered, deleted or added items) is never changed by a re-run.
--   * The administrator can rename, reorder, deactivate and delete them on Administration > Lists > Matter Categories like any other item.

IF NOT EXISTS (SELECT 1 FROM dbo.MatterCategory)
BEGIN
  INSERT dbo.MatterCategory (Name, SortOrder, IsActive)
  VALUES (N'Litigation', 1, 1), (N'Investigation', 2, 1), (N'Regulatory Inquiry', 3, 1), (N'Arbitration', 4, 1),
         (N'Second Request', 5, 1), (N'Internal Review', 6, 1), (N'Other', 7, 1);
END
GO
