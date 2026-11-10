using System.Linq.Expressions;
using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Domain;

namespace MatterFlow.Notifications.Application;

/// <summary>
/// Permission re-check on read: keeps only the notifications whose object the caller may view now, with one sub-select per object kind
/// (never a call per row). A kind nobody covers, or one the caller may not view at all, contributes nothing; the message text of an invisible
/// object is therefore never selected. Nothing is deleted when access is lost, so rows reappear when it returns.
/// </summary>
public sealed class NotificationVisibility(IEnumerable<IObjectVisibility> rules)
{
    public IQueryable<Notification> Visible(IQueryable<Notification> source)
    {
        Expression<Func<Notification, bool>>? predicate = null;
        foreach (var rule in rules)
        {
            var ids = rule.VisibleObjectIds();
            if (ids is null)
                continue;

            var kind = rule.ObjectKind;
            Expression<Func<Notification, bool>> one = n => n.ObjectKind == kind && ids.Contains(n.ObjectId);
            predicate = predicate is null ? one : Or(predicate, one);
        }

        return predicate is null ? source.Where(n => false) : source.Where(predicate);
    }

    private static Expression<Func<Notification, bool>> Or(Expression<Func<Notification, bool>> left, Expression<Func<Notification, bool>> right)
    {
        var parameter = left.Parameters[0];
        var body = Expression.OrElse(left.Body, new ParameterReplacer(right.Parameters[0], parameter).Visit(right.Body));
        return Expression.Lambda<Func<Notification, bool>>(body, parameter);
    }

    private sealed class ParameterReplacer(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
