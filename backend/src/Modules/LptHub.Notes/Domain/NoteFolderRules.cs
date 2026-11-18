using LptHub.SharedKernel.Results;

namespace LptHub.Notes.Domain;

/// <summary>The limits and the name rule of note folders (design docs/ux/notes-round-2/README.md section 3.2).</summary>
public static class NoteFolderRules
{
    /// <summary>Top-level folders are level 1.</summary>
    public const int MaxDepth = 5;

    public const int MaxPerMatter = 200;

    public const int MaxNameLength = 100;

    /// <summary>What a note without a folder is called in audit text.</summary>
    public const string NoFolderLabel = "No Folder";

    public const string PathSeparator = " > ";

    /// <summary>The name after trimming: 1 to 100 characters, no <c>/</c> or <c>\</c>, no control characters.</summary>
    public static Result<string> NormalizeName(string? name)
    {
        var trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");
        if (trimmed.Length > MaxNameLength)
            return Error.Validation("name", "TOO_LONG", $"A folder name can have at most {MaxNameLength} characters.");
        if (trimmed.Any(c => c is '/' or '\\' || char.IsControl(c)))
            return Error.Validation("name", "INVALID_CHARACTERS", "A folder name can't contain / or \\ or control characters.");
        return trimmed;
    }
}

/// <summary>A folder as the tree rules see it.</summary>
public readonly record struct NoteFolderNode(int Id, int? ParentId, string Name);

/// <summary>
/// The folders of ONE matter in memory (at most 200), with the questions the rules ask: level, height, path, cycle and name clash. A parent that is not in the list is treated as the top level
/// (the database guarantees it cannot happen).
/// </summary>
public sealed class NoteFolderTree
{
    private readonly Dictionary<int, NoteFolderNode> _byId;
    private readonly ILookup<int?, NoteFolderNode> _children;

    public NoteFolderTree(IEnumerable<NoteFolderNode> nodes)
    {
        _byId = nodes.ToDictionary(n => n.Id);
        _children = _byId.Values.ToLookup(n => n.ParentId);
    }

    public int Count => _byId.Count;

    public bool Contains(int id) => _byId.ContainsKey(id);

    public NoteFolderNode this[int id] => _byId[id];

    public IEnumerable<NoteFolderNode> Children(int? parentId) => _children[parentId];

    /// <summary>Level of a folder: 1 for a top-level folder. For <c>null</c> (the top level itself) 0.</summary>
    public int Level(int? id)
    {
        var level = 0;
        var seen = 0;
        for (var current = id; current is { } c && _byId.TryGetValue(c, out var node) && seen <= _byId.Count; current = node.ParentId, seen++)
            level++;
        return level;
    }

    /// <summary>Levels of the subtree under (and including) a folder: 1 for a folder without subfolders.</summary>
    public int Height(int id) => 1 + Children(id).Select(c => Height(c.Id)).DefaultIfEmpty(0).Max();

    /// <summary>The folder itself and all its subfolders, at any depth.</summary>
    public IReadOnlyList<int> SelfAndDescendants(int id)
    {
        var result = new List<int>();
        var stack = new Stack<int>();
        stack.Push(id);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            result.Add(current);
            foreach (var child in Children(current))
                stack.Push(child.Id);
        }

        return result;
    }

    /// <summary>True when moving <paramref name="id"/> under <paramref name="newParentId"/> would make a cycle (into itself or into one of its own subfolders).</summary>
    public bool WouldCycle(int id, int? newParentId) => newParentId is { } p && SelfAndDescendants(id).Contains(p);

    /// <summary>True when the folder, with its subfolders, placed under <paramref name="newParentId"/> would be deeper than <see cref="NoteFolderRules.MaxDepth"/> levels.</summary>
    public bool WouldBeTooDeep(int id, int? newParentId) => Level(newParentId) + Height(id) > NoteFolderRules.MaxDepth;

    /// <summary>The folder in <paramref name="parentId"/> with this name (case-insensitive, like the database), ignoring <paramref name="exceptId"/>.</summary>
    public NoteFolderNode? FindByName(int? parentId, string name, int? exceptId = null) =>
        Children(parentId).Where(c => c.Id != exceptId).Cast<NoteFolderNode?>().FirstOrDefault(c => string.Equals(c!.Value.Name, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>"Custodians &gt; Finance"; "No Folder" for the top level.</summary>
    public string Path(int? id)
    {
        if (id is null)
            return NoteFolderRules.NoFolderLabel;

        var names = new List<string>();
        var seen = 0;
        for (var current = id; current is { } c && _byId.TryGetValue(c, out var node) && seen <= _byId.Count; current = node.ParentId, seen++)
            names.Add(node.Name);
        names.Reverse();
        return string.Join(NoteFolderRules.PathSeparator, names);
    }
}
