using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.ApplicationModels;

namespace MatterFlow.Identity.Authorization;

/// <summary>
/// Fail-closed default for controller actions: an action that declares neither an authorization attribute nor <c>[AllowAnonymous]</c> is
/// protected by the "active, not pending" policy instead of being open. (A host-wide fallback policy would also turn unknown routes into
/// 401 instead of 404.) The architecture test additionally requires every action to declare its policy explicitly.
/// </summary>
public sealed class FailClosedConvention : IApplicationModelConvention
{
    public void Apply(ApplicationModel application)
    {
        foreach (var controller in application.Controllers)
        {
            foreach (var action in controller.Actions)
            {
                var attributes = action.Attributes.Concat(controller.Attributes).ToList();
                if (attributes.OfType<IAuthorizeData>().Any() || attributes.OfType<IAllowAnonymous>().Any())
                    continue;

                foreach (var selector in action.Selectors)
                    selector.EndpointMetadata.Add(new AuthorizeAttribute(AccessPolicies.NonPending));
            }
        }
    }
}
