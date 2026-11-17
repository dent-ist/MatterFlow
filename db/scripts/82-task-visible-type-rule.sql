-- 82-task-visible-type-rule.sql
-- Purpose: the SQL twin of the task visibility rule learns the Task Type access rule (epic #1397, issue #1400; design docs/ux/task-type-access/README.md section 4.3).
-- Owner: Identity (the visibility port); the function is read by tools and tests, not by the report login (DENY below).
-- Notes:
--   * dbo.fnTaskVisible (@UserId, @SeeAll) becomes dbo.fnTaskVisible (@UserId, @SeeAll, @IsAdmin). The matter term is unchanged. The new term is AND-ed on the outside:
--     a task of a restricted Task Type (dbo.TaskType.IsRestricted = 1) is visible only to the System Admin (@IsAdmin = 1) or to a user who holds, through an ACTIVE role,
--     a role with CanView = 1 on that type. No exception for the assignee and none for @SeeAll (Matter.ViewSensitive does not lift the type rule).
--   * @IsAdmin has its own flag because @SeeAll is also true for holders of Matter.ViewSensitive, who are not exempt from the type rule.
--   * The function does not read the Features:TaskTypeAccess switch: the C# callers decide, as they do for the matter rule. It stays an inline table-valued function
--     (no scalar function, no multi-statement function: both would block inlining, the lesson of issue #810).
--   * A dropped function loses its grants and denies: the DENY for the report login is re-issued for the new signature.

DROP FUNCTION dbo.fnTaskVisible;
GO

CREATE FUNCTION dbo.fnTaskVisible (@UserId INT, @SeeAll BIT, @IsAdmin BIT)
RETURNS TABLE
AS
RETURN
(
  SELECT t.TaskId, t.MatterId
  FROM dbo.Task t
  WHERE (ISNULL(@SeeAll, 0) = 1
         OR EXISTS (SELECT 1 FROM dbo.Matter m
                    WHERE m.MatterId = t.MatterId
                      AND (m.IsSensitive = 0 OR (@UserId IS NOT NULL AND (m.PrimaryManagerId = @UserId OR m.SecondaryManagerId = @UserId))))
         OR (@UserId IS NOT NULL AND t.AssignedUserId = @UserId))
    AND (ISNULL(@IsAdmin, 0) = 1
         OR NOT EXISTS (SELECT 1 FROM dbo.TaskType ty WHERE ty.TaskTypeId = t.TaskTypeId AND ty.IsRestricted = 1)
         OR (@UserId IS NOT NULL
             AND EXISTS (SELECT 1
                         FROM dbo.TaskTypeRoleAccess a
                         JOIN dbo.UserRole ur ON ur.RoleId = a.RoleId AND ur.UserId = @UserId
                         JOIN dbo.Role r ON r.RoleId = ur.RoleId AND r.IsActive = 1
                         WHERE a.TaskTypeId = t.TaskTypeId AND a.CanView = 1)))
);
GO

DENY SELECT ON [dbo].[fnTaskVisible] TO [lpt_report_reader];
GO
