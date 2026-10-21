using System.Net;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Search.SearchData;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Search;

/// <summary>GET /api/v1/search (ticket 52): number normalization, SCN-020, FND-17, per-type permissions, ranking, LIKE-injection safety.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class GlobalSearchApiTests(SqlServerFixture sql)
{
    private Task<SearchData> DataAsync() => SearchData.GetAsync(sql);

    [Theory]
    [InlineData("00002-00001")]
    [InlineData("2-1")]
    [InlineData("00002-1")]
    [InlineData("0002-0001")]
    public async Task Scn020_a_combined_number_finds_the_matter_first_and_its_related_records_but_not_other_matters(string query)
    {
        var d = await DataAsync();
        var r = await d.SearchAsync(query);

        r.GetProperty("normalized").GetString().ShouldBe("00002-00001");
        var matters = Group(r, "matter")!.Value.GetProperty("items");
        matters.GetArrayLength().ShouldBe(1);
        matters[0].GetProperty("reference").GetString().ShouldBe("00002-00001");
        matters[0].GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
        matters[0].GetProperty("path").GetString().ShouldBe($"/matters/{d.BetaMatterId}");

        Labels(r, "client").ShouldBe(["Beta Industries"]);
        Labels(r, "project").ShouldBe(["Beta Phase"]);
        Labels(r, "task").ShouldBe(["Collect beta documents"]);
        Labels(r, "asset").ShouldBe(["Beta custodian laptop"]);
        var task = Group(r, "task")!.Value.GetProperty("items")[0];
        task.GetProperty("matterRef").GetString().ShouldBe("00002-00001");
        task.GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
        Types(r).ShouldBe(["client", "matter", "project", "task", "asset"]);
    }

    [Fact]
    public async Task Scn020_returns_only_the_types_the_caller_may_view_never_data_they_cannot_access()
    {
        var d = await DataAsync();

        Types(await d.SearchAsync("00002-00001", d.MatterOnly)).ShouldBe(["matter"]);
        Types(await d.SearchAsync("00002-00001", d.ClientOnly)).ShouldBe(["client"]);
        Types(await d.SearchAsync("00002-00001", d.TaskOnly)).ShouldBe(["task"]);
        Types(await d.SearchAsync("00002-00001", d.AssetOnly)).ShouldBe(["asset"]);
        Labels(await d.SearchAsync("00002-00001", d.TaskOnly), "task").ShouldBe(["Collect beta documents"]);

        // Asking for a type the caller may not view leaves it out instead of leaking or failing.
        var asked = await d.SearchAsync("00002-00001", d.MatterOnly, "&types=matter&types=task,asset");
        Types(asked).ShouldBe(["matter"]);
        Types(await d.SearchAsync("00002-00001", d.ClientOnly, "&types=task")).ShouldBeEmpty();

        // The Admin sees every type the same query returns; a caller with no View permission at all is refused.
        Types(await d.SearchAsync("00002-00001")).Count.ShouldBe(5);
        await ProblemAsync(await d.NoSearch.GetAsync("/api/v1/search?q=beta"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        (await d.H.As(@"KE\someone-new").GetAsync("/api/v1/search?q=beta")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Theory]
    [InlineData("343")]
    [InlineData("00343")]
    [InlineData(" 343 ")]
    public async Task Padded_and_unpadded_client_numbers_find_the_same_client_and_its_matters(string query)
    {
        var d = await DataAsync();
        var r = await d.SearchAsync(query);

        r.GetProperty("normalized").GetString().ShouldBe("00343");
        References(r, "client").First().ShouldBe("00343");
        Labels(r, "client").First().ShouldBe("Acme Corp 343");
        References(r, "matter").ShouldContain("00343-00012");
        References(r, "matter").ShouldContain("00343-00013");
    }

    [Theory]
    [InlineData("343-12")]
    [InlineData("00343-00012")]
    [InlineData("343-00012")]
    [InlineData("00343-12")]
    public async Task Combined_matter_numbers_in_any_padding_resolve_to_the_matter(string query)
    {
        var d = await DataAsync();
        var r = await d.SearchAsync(query);

        References(r, "matter").First().ShouldBe("00343-00012");
        Labels(r, "project").ShouldContain("Phase 1");
        Labels(r, "task").ShouldContain("Number twin task");
    }

    [Fact]
    public async Task A_client_number_with_a_dash_lists_that_clients_matters_and_a_partial_matter_number_matches_by_prefix()
    {
        var d = await DataAsync();
        var byClient = await d.SearchAsync("343-");
        byClient.GetProperty("normalized").GetString().ShouldBe("00343-");
        References(byClient, "matter").ShouldBe(["00343-00012", "00343-00013"]);

        // As-you-type: "343-1" also finds 00343-00012 and 00343-00013 (both start with 1 after the padding).
        var partial = await d.SearchAsync("343-1");
        References(partial, "matter").ShouldBe(["00343-00012", "00343-00013"]);
        References(await d.SearchAsync("343-13"), "matter").ShouldBe(["00343-00013"]);
    }

    [Fact]
    public async Task Fnd17_a_numeric_term_returns_grouped_client_matter_and_task_hits()
    {
        var d = await DataAsync();
        var r = await d.SearchAsync(d.TwinNumber.ToString());

        Types(r).ShouldBe(["client", "matter", "project", "task", "asset"]);
        References(r, "client").ShouldContain(d.TwinNumber.ToString("D5"));
        Labels(r, "client").First().ShouldBe("Twin Client");
        Labels(r, "matter").ShouldContain("Twin Matter");
        References(r, "task").First().ShouldBe($"TSK-{d.TwinNumber}");
        Labels(r, "task").First().ShouldBe("Number twin task");

        // The Task is found by its prefixed and lower-case forms as well.
        foreach (var form in new[] { $"TSK-{d.TwinNumber}", $"tsk-{d.TwinNumber}" })
            References(await d.SearchAsync(form), "task").First().ShouldBe($"TSK-{d.TwinNumber}");
    }

    [Fact]
    public async Task Short_input_unknown_types_and_unknown_parameters_are_rejected()
    {
        var d = await DataAsync();
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search?q=a"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search?q=%20%20a%20"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search?q=beta&types=people"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search?q=beta&limit=0"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search?q=beta&limit=51"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search?q=beta&page=2"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        (await d.Admin.GetAsync("/api/v1/search?q=" + new string('x', 201))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await d.Admin.GetAsync("/api/v1/search?q=ab")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await d.Admin.GetAsync("/api/v1/search?q=7")).StatusCode.ShouldBe(HttpStatusCode.OK); // a one-digit number is searchable
    }

    [Fact]
    public async Task Each_type_is_capped_and_reports_whether_more_matches_exist()
    {
        var d = await DataAsync();
        var capped = await d.SearchAsync("orbit", extra: "&types=client&limit=2");
        var group = Group(capped, "client")!.Value;
        group.GetProperty("items").GetArrayLength().ShouldBe(2);
        group.GetProperty("hasMore").GetBoolean().ShouldBeTrue();

        var all = await d.SearchAsync("orbit", extra: "&types=client&limit=10");
        Group(all, "client")!.Value.GetProperty("hasMore").GetBoolean().ShouldBeFalse();

        // Default cap is five per type.
        Group(await d.SearchAsync("ac"), "client")!.Value.GetProperty("items").GetArrayLength().ShouldBeLessThanOrEqualTo(5);
    }

    [Fact]
    public async Task Ranking_is_whole_value_then_start_then_word_start_then_inside_and_is_case_insensitive()
    {
        var d = await DataAsync();
        var expected = new[] { "Orbit", "Orbit Holdings", "Big Orbit Group", "Reorbital Ltd" };

        Labels(await d.SearchAsync("orbit"), "client").ShouldBe(expected);
        Labels(await d.SearchAsync("ORBIT"), "client").ShouldBe(expected);
        Labels(await d.SearchAsync("OrBiT"), "client").ShouldBe(expected);
        // The same query twice returns the same order (stable).
        Labels(await d.SearchAsync("orbit"), "client").ShouldBe(Labels(await d.SearchAsync("orbit"), "client"));
    }

    [Fact]
    public async Task An_exact_number_ranks_above_a_prefix_match_and_the_order_inside_a_tier_is_stable()
    {
        var d = await DataAsync();
        // "34": Client 00034 is the exact number; 00343 only starts with it.
        var r = await d.SearchAsync("34");
        References(r, "client").Take(2).ShouldBe(["00034", "00343"]);
        References(r, "matter").First().ShouldBe("00034-00001");
        References(r, "matter").ShouldContain("00343-00012");
    }

    [Fact]
    public async Task Tasks_match_on_title_number_and_requestor_and_assets_on_name_reference_and_type()
    {
        var d = await DataAsync();
        Labels(await d.SearchAsync("beta documents"), "task").ShouldBe(["Collect beta documents"]);
        Labels(await d.SearchAsync("rita"), "task").ShouldBe(["Collect beta documents"]);
        Labels(await d.SearchAsync(d.BetaTaskNumber), "task").First().ShouldBe("Collect beta documents");

        Labels(await d.SearchAsync("EVID-0002"), "asset").ShouldBe(["Beta custodian laptop"]);
        Labels(await d.SearchAsync("evid-"), "asset").ShouldBe(["Beta custodian laptop"]);
        Labels(await d.SearchAsync("custodian"), "asset").ShouldBe(["Beta custodian laptop"]);
        Labels(await d.SearchAsync("server"), "asset").ShouldBe(["Decoy file server"]);
        Labels(await d.SearchAsync("laptop"), "asset").ShouldBe(["Beta custodian laptop"]);
    }

    [Fact]
    public async Task A_hit_carries_its_matter_reference_and_sensitivity_for_projects_and_assets()
    {
        var d = await DataAsync();
        var project = Group(await d.SearchAsync("beta phase"), "project")!.Value.GetProperty("items")[0];
        project.GetProperty("matterRef").GetString().ShouldBe("00002-00001");
        project.GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
        project.GetProperty("path").GetString().ShouldBe($"/projects/{d.BetaProjectId}");

        var asset = Group(await d.SearchAsync("beta custodian"), "asset")!.Value.GetProperty("items")[0];
        asset.GetProperty("path").GetString().ShouldBe($"/assets/{d.BetaAssetId}");
        asset.GetProperty("secondary").GetString().ShouldBe("Laptop");
        Group(await d.SearchAsync("decoy file"), "asset")!.Value.GetProperty("items")[0].GetProperty("isSensitive").GetBoolean().ShouldBeFalse();
    }

    [Theory]
    [InlineData("100%", "Rate 100% [Final]_Set")]
    [InlineData("100% [", "Rate 100% [Final]_Set")]
    [InlineData("[Final]", "Rate 100% [Final]_Set")]
    [InlineData("]_S", "Rate 100% [Final]_Set")]
    [InlineData("_Set", "Rate 100% [Final]_Set")]
    [InlineData(@"back\s", @"Back\slash Corp")]
    [InlineData(@"\slash", @"Back\slash Corp")]
    public async Task Like_wildcards_typed_by_the_user_are_matched_literally(string query, string expectedClient)
    {
        var d = await DataAsync();
        Labels(await d.SearchAsync(query), "client").ShouldBe([expectedClient]);
    }

    [Theory]
    [InlineData("%%")]
    [InlineData("__")]
    [InlineData("[a-z]")]
    [InlineData("[^a]x")]
    [InlineData("%a%")]
    [InlineData("100_")]
    [InlineData("' OR 1=1 --")]
    [InlineData("'; DROP TABLE dbo.Client; --")]
    [InlineData("\\%")]
    public async Task Wildcard_and_injection_inputs_match_nothing_and_never_everything(string query)
    {
        var d = await DataAsync();
        var r = await d.SearchAsync(query);
        foreach (var group in r.GetProperty("groups").EnumerateArray())
            group.GetProperty("items").GetArrayLength().ShouldBe(0, $"{group.GetProperty("type").GetString()} for '{query}'");

        // The table is intact and the search still works afterwards.
        Labels(await d.SearchAsync("orbit"), "client").ShouldNotBeEmpty();
    }

    [Fact]
    public async Task The_hundred_percent_prefix_does_not_match_the_name_without_a_percent_sign()
    {
        var d = await DataAsync();
        Labels(await d.SearchAsync("rate 100"), "client").ShouldBe(["Rate 100 Final Set X", "Rate 100% [Final]_Set"]);
        Labels(await d.SearchAsync("rate 100%"), "client").ShouldBe(["Rate 100% [Final]_Set"]);
    }

    [Theory]
    [InlineData("orbit")]
    [InlineData("beta")]
    [InlineData("343")]
    [InlineData("343-12")]
    [InlineData("00343-00012")]
    [InlineData("collect")]
    [InlineData("laptop")]
    [InlineData("zzzzqqq")]
    public async Task S1_totals_equal_the_advanced_search_total_of_each_type_for_the_same_query(string query)
    {
        var d = await DataAsync();
        var r = await d.SearchAsync(query, extra: "&limit=1");

        foreach (var group in r.GetProperty("groups").EnumerateArray())
        {
            var type = group.GetProperty("type").GetString()!;
            var advanced = await d.AdvancedAsync($"type={type}&q={Uri.EscapeDataString(query)}&pageSize=1");
            group.GetProperty("total").GetInt32().ShouldBe(advanced.GetProperty("total").GetInt32(), $"{type} total for '{query}'");
            group.GetProperty("totalCapped").GetBoolean().ShouldBeFalse();
        }

        r.GetProperty("searchedTypes").EnumerateArray().Select(t => t.GetString()).ShouldBe(["client", "matter", "project", "task", "asset"]);
    }

    [Fact]
    public async Task S1_the_total_counts_every_match_while_limit_caps_the_items_only()
    {
        var d = await DataAsync();
        var r = await d.SearchAsync("orbit", extra: "&types=client&limit=2");
        var group = Group(r, "client")!.Value;

        group.GetProperty("items").GetArrayLength().ShouldBe(2);
        group.GetProperty("total").GetInt32().ShouldBe(4); // Orbit, Orbit Holdings, Big Orbit Group, Reorbital Ltd
        group.GetProperty("totalCapped").GetBoolean().ShouldBeFalse();
        r.GetProperty("searchedTypes").EnumerateArray().Select(t => t.GetString()).ShouldBe(["client"]);

        var none = Group(await d.SearchAsync("zzzzqqq"), "task")!.Value;
        none.GetProperty("total").GetInt32().ShouldBe(0);
        none.GetProperty("items").GetArrayLength().ShouldBe(0);
    }

    [Theory]
    [InlineData("343-12")]
    [InlineData("00343-00012")]
    public async Task S1_number_inputs_count_in_both_shapes(string query)
    {
        var d = await DataAsync();
        var r = await d.SearchAsync(query);

        Group(r, "matter")!.Value.GetProperty("total").GetInt32().ShouldBe(1);
        var reference = await d.SearchAsync("00343-00012");
        foreach (var type in SearchTypes)
            Group(r, type)!.Value.GetProperty("total").GetInt32().ShouldBe(Group(reference, type)!.Value.GetProperty("total").GetInt32(), type);
    }

    [Fact]
    public async Task S1_searched_types_list_only_the_types_the_caller_may_view_and_asked_for()
    {
        var d = await DataAsync();
        static List<string> Searched(System.Text.Json.JsonElement r) => [.. r.GetProperty("searchedTypes").EnumerateArray().Select(t => t.GetString()!)];

        Searched(await d.SearchAsync("beta", d.TaskOnly)).ShouldBe(["task"]);
        Searched(await d.SearchAsync("beta", d.AssetOnly)).ShouldBe(["asset"]);
        Searched(await d.SearchAsync("beta", d.ClientOnly)).ShouldBe(["client"]);
        Searched(await d.SearchAsync("beta", d.MatterOnly, "&types=matter&types=task,asset")).ShouldBe(["matter"]);
        Searched(await d.SearchAsync("beta", d.ClientOnly, "&types=task")).ShouldBeEmpty();

        var taskOnly = await d.SearchAsync("beta", d.TaskOnly);
        Group(taskOnly, "task")!.Value.GetProperty("total").GetInt32().ShouldBe(1);
        Group(taskOnly, "matter").ShouldBeNull();
    }

    private static readonly string[] SearchTypes = ["client", "matter", "project", "task", "asset"];
}
