using System.ComponentModel.DataAnnotations;
using MatterFlow.Assets.Contracts;

namespace MatterFlow.Assets.Application;

/// <summary>The Tasks an Asset is linked to (supplied by the Task module through <see cref="IAssetTaskLinkReader"/>).</summary>
/// <param name="Items">Newest link first.</param>
public sealed record AssetLinkedTasksResponse([property: Required] IReadOnlyList<AssetTaskLink> Items);
