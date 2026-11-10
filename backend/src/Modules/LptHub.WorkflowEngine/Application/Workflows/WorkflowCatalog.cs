using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkflowEngine.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkflowEngine.Application.Workflows;

/// <summary>Read side of the workflow configuration for other modules (<see cref="IWorkflowCatalog"/>).</summary>
public sealed class WorkflowCatalog(DbContext db) : IWorkflowCatalog
{
    public async Task<IReadOnlyList<PublishedWorkflowSummary>> ListPublishedAsync(CancellationToken cancellationToken = default) =>
        await Published(null).ToListAsync(cancellationToken);

    public Task<PublishedWorkflowSummary?> GetPublishedSummaryAsync(int workflowDefinitionId, CancellationToken cancellationToken = default) =>
        Published(workflowDefinitionId).SingleOrDefaultAsync(cancellationToken);

    public async Task<Result<WorkflowVersionSnapshot>> GetPublishedVersionAsync(int workflowDefinitionId, CancellationToken cancellationToken = default)
    {
        var definition = await db.Set<WorkflowDefinition>().AsNoTracking().Where(w => w.Id == workflowDefinitionId).Select(w => new { w.IsActive }).SingleOrDefaultAsync(cancellationToken);
        if (definition is null)
        {
            return Error.NotFound($"Workflow {workflowDefinitionId} does not exist.");
        }

        var versionId = definition.IsActive
            ? await db.Set<WorkflowVersion>().AsNoTracking()
                .Where(v => v.WorkflowDefinitionId == workflowDefinitionId && v.Status == WorkflowVersionStatus.Published)
                .Select(v => (int?)v.Id)
                .SingleOrDefaultAsync(cancellationToken)
            : null;
        if (versionId is null)
        {
            return Error.Conflict(ErrorCodes.WorkflowNotPublished, $"Workflow {workflowDefinitionId} has no published version available for new tasks.");
        }

        return (await GetVersionAsync(versionId.Value, cancellationToken))!;
    }

    public async Task<WorkflowVersionSnapshot?> GetVersionAsync(int workflowVersionId, CancellationToken cancellationToken = default)
    {
        var head = await (
            from v in db.Set<WorkflowVersion>().AsNoTracking()
            where v.Id == workflowVersionId
            join w in db.Set<WorkflowDefinition>().AsNoTracking() on v.WorkflowDefinitionId equals w.Id
            select new { v.WorkflowDefinitionId, w.Name, v.Id, v.VersionNo, v.Status, v.IsOrdered }).SingleOrDefaultAsync(cancellationToken);
        if (head is null)
        {
            return null;
        }

        var steps = await db.Set<WorkflowVersionStep>().AsNoTracking()
            .Where(s => s.WorkflowVersionId == workflowVersionId)
            .OrderBy(s => s.SequenceNo)
            .Select(s => new WorkflowStepSnapshot(
                s.Id,
                s.SequenceNo,
                s.SourceStepDefinitionId,
                s.Title,
                s.Description,
                s.Instructions,
                s.DocumentationUrl,
                s.StepFormVersionId,
                s.IsSkippable,
                s.SkipCommentRequired))
            .ToListAsync(cancellationToken);
        return new WorkflowVersionSnapshot(head.WorkflowDefinitionId, head.Name, head.Id, head.VersionNo, head.Status, head.IsOrdered, steps);
    }

    public Task<bool> ExistsAsync(int workflowDefinitionId, CancellationToken cancellationToken = default) =>
        db.Set<WorkflowDefinition>().AnyAsync(w => w.Id == workflowDefinitionId, cancellationToken);

    private IQueryable<PublishedWorkflowSummary> Published(int? workflowDefinitionId) =>
        from v in db.Set<WorkflowVersion>().AsNoTracking()
        where v.Status == WorkflowVersionStatus.Published
        join w in db.Set<WorkflowDefinition>().AsNoTracking() on v.WorkflowDefinitionId equals w.Id
        where w.IsActive && (workflowDefinitionId == null || w.Id == workflowDefinitionId)
        orderby w.Name, w.Id
        select new PublishedWorkflowSummary(
            w.Id,
            w.Name,
            w.Description,
            v.Id,
            v.VersionNo,
            v.IsOrdered,
            v.Steps.Count,
            v.PublishedAt!.Value);
}
