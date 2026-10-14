using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;
using static MatterFlow.IntegrationTests.WorkViews.QueueData;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /api/v1/task-queue (ticket 49): ordering (addendum G), overdue per time zone (addendum M), filters, sorting, paging; SCN-015.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskQueueApiTests(SqlServerFixture sql)
{
    private Task<QueueData> DataAsync() => QueueData.GetAsync(sql);

    private static string[] Of(params string[] titles) => titles;

    [Fact]
    public async Task Default_order_is_priority_then_asap_above_due_dates_oldest_first_then_due_ascending()
    {
        var d = await DataAsync();
        var page = await d.QueueAsync();

        d.Seeded(page).Where(t => t is "crit-future" or "crit-asap-old" or "crit-overdue" or "crit-asap-new" or "high-asap" or "norm-timed-past" or "norm-asap" or "low-future-timed")
            .ShouldBe(Of("crit-asap-old", "crit-asap-new", "crit-overdue", "crit-future", "high-asap", "norm-asap", "norm-timed-past", "low-future-timed"));

        // Every Critical task precedes every High one, and so on (priority is the first key).
        var order = page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("priority").GetProperty("sortOrder").GetInt32()).ToList();
        order.ShouldBe([.. order.Order()]);

        // Within each priority all ASAP rows come before every explicit due date, ASAP rows oldest first.
        foreach (var group in page.GetProperty("items").EnumerateArray().GroupBy(i => i.GetProperty("priority").GetProperty("priorityId").GetInt32()))
        {
            var rows = group.ToList();
            var firstExplicit = rows.FindIndex(r => !r.GetProperty("isAsap").GetBoolean());
            if (firstExplicit >= 0)
                rows.Skip(firstExplicit).ShouldAllBe(r => !r.GetProperty("isAsap").GetBoolean());
            var asapCreated = rows.Where(r => r.GetProperty("isAsap").GetBoolean()).Select(r => r.GetProperty("createdAtUtc").GetDateTime()).ToList();
            asapCreated.ShouldBe([.. asapCreated.Order()]);
        }
    }

    [Fact]
    public async Task Explicit_default_sort_matches_no_sort_and_other_sorts_apply_the_direction()
    {
        var d = await DataAsync();
        TitlesOf(await d.QueueAsync("sort=default")).ShouldBe(TitlesOf(await d.QueueAsync()));
        TitlesOf(await d.QueueAsync("sort=default&dir=desc")).ShouldBe(TitlesOf(await d.QueueAsync()));

        var dueAsc = await d.QueueAsync("sort=due&dir=asc&overdue=false");
        var dueDesc = await d.QueueAsync("sort=due&dir=desc&overdue=false");
        dueAsc.GetProperty("items")[0].GetProperty("isAsap").GetBoolean().ShouldBeTrue();
        var descItems = dueDesc.GetProperty("items");
        descItems[descItems.GetArrayLength() - 1].GetProperty("isAsap").GetBoolean().ShouldBeTrue();
        descItems[0].GetProperty("isAsap").GetBoolean().ShouldBeFalse();
        var desc = d.Seeded(dueDesc);
        var asc = d.Seeded(dueAsc);
        desc.IndexOf("low-future-timed").ShouldBeLessThan(desc.IndexOf("crit-future"));
        asc.IndexOf("crit-future").ShouldBeLessThan(asc.IndexOf("low-future-timed"));

        var newest = d.Seeded(await d.QueueAsync("sort=created"));
        newest.First().ShouldBe("former-employee");
        d.Seeded(await d.QueueAsync("sort=created&dir=asc")).First().ShouldBe("crit-future");
        d.Seeded(await d.QueueAsync("sort=number&dir=asc")).ShouldBe(d.Titles.OrderBy(t => d.Id(t)).ToList());
        d.Seeded(await d.QueueAsync("sort=number&dir=desc")).ShouldBe(d.Titles.OrderByDescending(t => d.Id(t)).ToList());
        d.Seeded(await d.QueueAsync("sort=status&dir=desc"))[0].ShouldBeOneOf("mine-cancelled");
        TitlesOf(await d.QueueAsync("sort=priority")).ShouldBe(TitlesOf(await d.QueueAsync()));
    }

    [Fact]
    public async Task Invalid_sort_direction_page_and_unknown_parameters_are_400()
    {
        var d = await DataAsync();
        async Task BadAsync(string query, string code) =>
            await ProblemAsync(await d.H.Admin.GetAsync("/api/v1/task-queue?" + query), HttpStatusCode.BadRequest, code);

        await BadAsync("sort=bogus", "VALIDATION_FAILED");
        await BadAsync("dir=sideways", "VALIDATION_FAILED");
        await BadAsync("status=DONE", "VALIDATION_FAILED");
        await BadAsync("pageSize=101", "VALIDATION_FAILED");
        await BadAsync("page=0", "VALIDATION_FAILED");
        await BadAsync("colour=red", "VALIDATION_FAILED");
        await BadAsync("assignee=abc", "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Rows_carry_everything_the_table_shows()
    {
        var d = await DataAsync();
        var page = await d.QueueAsync("q=with-project");
        page.GetProperty("total").GetInt32().ShouldBe(1);
        page.GetProperty("timeZone").GetString().ShouldBe("America/New_York");
        var row = Row(page, "with-project");
        row.GetProperty("taskId").GetInt64().ShouldBe(d.Id("with-project"));
        row.GetProperty("taskNumber").GetString().ShouldStartWith("TSK-");
        row.GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        row.GetProperty("matterName").GetString().ShouldBe("Merger Review 12");
        row.GetProperty("matterIsSensitive").GetBoolean().ShouldBeFalse();
        row.GetProperty("clientName").GetString().ShouldBe("Acme Corp 343");
        row.GetProperty("projectName").GetString().ShouldBe("Phase 1");
        row.GetProperty("taskTypeName").GetString().ShouldBe("Data Processing");
        row.GetProperty("workflowName").GetString().ShouldBe("Ordered flow");
        row.GetProperty("priority").GetProperty("label").GetString().ShouldBe("Normal");
        row.GetProperty("priority").GetProperty("color").GetString().ShouldNotBeNullOrEmpty();
        row.GetProperty("status").GetString().ShouldBe("NEW");
        row.GetProperty("statusLabel").GetString().ShouldBe("New");
        row.GetProperty("assignedUser").ValueKind.ShouldBe(JsonValueKind.Null);
        row.GetProperty("assignedPod").ValueKind.ShouldBe(JsonValueKind.Null);
        row.GetProperty("createdBy").GetProperty("userId").GetInt32().ShouldBe(d.Admin);
        row.GetProperty("requestorName").GetString().ShouldBe("Pat Partner");
        row.GetProperty("isAsap").GetBoolean().ShouldBeTrue();
        row.GetProperty("isOverdue").GetBoolean().ShouldBeFalse();
        row.GetProperty("rowVersion").GetString().ShouldNotBeNullOrEmpty();

        // The ordered workflow has three steps; none is resolved, so the first one is current.
        var workflow = row.GetProperty("workflow");
        workflow.GetProperty("stepsTotal").GetInt32().ShouldBe(3);
        workflow.GetProperty("stepsResolved").GetInt32().ShouldBe(0);
        workflow.GetProperty("currentStepNumber").GetInt32().ShouldBe(1);
        workflow.GetProperty("currentStepName").GetString().ShouldBe("Intake review");

        var timed = Row(await d.QueueAsync("q=norm-timed-past"), "norm-timed-past");
        timed.GetProperty("dueDate").GetString().ShouldBe("2000-01-02");
        timed.GetProperty("dueAtUtc").GetDateTime().ShouldBe(new DateTime(2000, 1, 2, 14, 0, 0, DateTimeKind.Utc)); // 09:00 in New York (EST)
        timed.GetProperty("isAsap").GetBoolean().ShouldBeFalse();

        var done = Row(await d.QueueAsync("q=mine-done"), "mine-done");
        done.GetProperty("workflow").GetProperty("stepsResolved").GetInt32().ShouldBe(2);
        done.GetProperty("workflow").GetProperty("currentStepNumber").ValueKind.ShouldBe(JsonValueKind.Null);
        done.GetProperty("completedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);
    }

    [Fact]
    public async Task Paging_returns_total_and_consecutive_pages_that_add_up_to_the_default_order()
    {
        var d = await DataAsync();
        var all = TitlesOf(await d.QueueAsync());
        var total = (await d.QueueAsync()).GetProperty("total").GetInt32();
        all.Count.ShouldBe(total);

        var collected = new List<string>();
        for (var page = 1; page <= 4; page++)
        {
            var result = await d.GetAsync($"/api/v1/task-queue?pageSize=10&page={page}");
            result.GetProperty("total").GetInt32().ShouldBe(total);
            result.GetProperty("page").GetInt32().ShouldBe(page);
            result.GetProperty("pageSize").GetInt32().ShouldBe(10);
            collected.AddRange(TitlesOf(result));
        }

        collected.ShouldBe(all.Take(40).ToList());

        var beyond = await d.GetAsync("/api/v1/task-queue?pageSize=10&page=99");
        beyond.GetProperty("items").GetArrayLength().ShouldBe(0);
        beyond.GetProperty("total").GetInt32().ShouldBe(total);
        (await d.GetAsync("/api/v1/task-queue")).GetProperty("pageSize").GetInt32().ShouldBe(25);
    }

    [Fact]
    public async Task Scn015_asap_is_never_overdue_and_the_asap_filter_returns_only_asap_rows()
    {
        var d = await DataAsync();
        var overdue = await d.QueueAsync("overdue=true");
        var titles = TitlesOf(overdue);
        titles.ShouldContain("crit-overdue");
        titles.ShouldContain("norm-timed-past");
        titles.ShouldContain("mine-overdue");
        titles.ShouldContain("poda-queue-2");
        titles.ShouldNotContain("crit-asap-old");
        titles.ShouldNotContain("high-asap");
        titles.ShouldNotContain("crit-future");
        titles.ShouldNotContain("mine-done"); // past due but completed
        overdue.GetProperty("items").EnumerateArray().ShouldAllBe(r => r.GetProperty("isOverdue").GetBoolean() && !r.GetProperty("isAsap").GetBoolean());

        var asap = await d.QueueAsync("asap=true");
        asap.GetProperty("items").EnumerateArray().ShouldAllBe(r => r.GetProperty("isAsap").GetBoolean() && !r.GetProperty("isOverdue").GetBoolean());
        TitlesOf(asap).ShouldContain("crit-asap-old");
        TitlesOf(asap).ShouldNotContain("crit-future");

        var dated = await d.QueueAsync("asap=false");
        dated.GetProperty("items").EnumerateArray().ShouldAllBe(r => !r.GetProperty("isAsap").GetBoolean());

        var notOverdue = TitlesOf(await d.QueueAsync("overdue=false"));
        notOverdue.ShouldContain("crit-asap-old");
        notOverdue.ShouldContain("mine-done");
        notOverdue.ShouldNotContain("crit-overdue");
        (titles.Count + notOverdue.Count).ShouldBe((await d.QueueAsync()).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task A_date_only_due_date_is_overdue_in_the_viewers_zone_near_midnight()
    {
        var d = await DataAsync();
        // The task is due on today's date in Pago Pago (UTC-11). Kiritimati (UTC+14) is 25 hours ahead, so its calendar date is always later.
        var early = await d.QueueAsync("q=tz-date-only", timeZone: "Pacific/Pago_Pago");
        var late = await d.QueueAsync("q=tz-date-only", timeZone: "Pacific/Kiritimati");
        Row(early, "tz-date-only").GetProperty("isOverdue").GetBoolean().ShouldBeFalse();
        Row(late, "tz-date-only").GetProperty("isOverdue").GetBoolean().ShouldBeTrue();
        early.GetProperty("timeZone").GetString().ShouldBe("Pacific/Pago_Pago");

        TitlesOf(await d.QueueAsync("overdue=true", timeZone: "Pacific/Pago_Pago")).ShouldNotContain("tz-date-only");
        TitlesOf(await d.QueueAsync("overdue=true", timeZone: "Pacific/Kiritimati")).ShouldContain("tz-date-only");
        TitlesOf(await d.QueueAsync("overdue=false", timeZone: "Pacific/Pago_Pago")).ShouldContain("tz-date-only");
        TitlesOf(await d.QueueAsync("overdue=false", timeZone: "Pacific/Kiritimati")).ShouldNotContain("tz-date-only");

        // A task with a time is an absolute instant: the same answer for every viewer.
        var future = Row(await d.QueueAsync("q=low-future-timed", timeZone: "Pacific/Kiritimati"), "low-future-timed");
        future.GetProperty("isOverdue").GetBoolean().ShouldBeFalse();
        Row(await d.QueueAsync("q=norm-timed-past", timeZone: "Pacific/Pago_Pago"), "norm-timed-past").GetProperty("isOverdue").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task Text_search_matches_title_and_task_number_partially_and_case_insensitively()
    {
        var d = await DataAsync();
        TitlesOf(await d.QueueAsync("q=CRIT-ASAP")).ShouldBe(Of("crit-asap-old", "crit-asap-new"));

        var number = Row(await d.QueueAsync("q=with-project"), "with-project").GetProperty("taskNumber").GetString()!;
        TitlesOf(await d.QueueAsync("q=" + number)).ShouldContain("with-project");
        TitlesOf(await d.QueueAsync("q=" + number.ToLowerInvariant())).ShouldContain("with-project");
        TitlesOf(await d.QueueAsync("q=" + number["TSK-".Length..])).ShouldContain("with-project");

        (await d.QueueAsync("q=%25")).GetProperty("total").GetInt32().ShouldBe(0); // a literal percent sign, not a wildcard
        (await d.QueueAsync("q=nothing-has-this-title")).GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task Status_priority_and_type_filters_accept_repeated_values()
    {
        var d = await DataAsync();
        var held = await d.QueueAsync("status=ON_HOLD");
        TitlesOf(held).ShouldBeSet(["mine-hold", "poda-hold"]);

        var openOrDone = await d.QueueAsync("status=ON_HOLD&status=COMPLETED");
        TitlesOf(openOrDone).ShouldBeSet(["mine-hold", "poda-hold", "mine-done", "poda-done"]);
        TitlesOf(await d.QueueAsync("status=ON_HOLD,CANCELLED")).ShouldBeSet(["mine-hold", "poda-hold", "mine-cancelled"]);
        TitlesOf(await d.QueueAsync("status=cancelled")).ShouldBe(Of("mine-cancelled"));

        TitlesOf(await d.QueueAsync($"priority={d.Critical}")).ShouldBeSet(["crit-future", "crit-asap-old", "crit-overdue", "crit-asap-new"]);
        TitlesOf(await d.QueueAsync($"priority={d.Critical}&priority={d.Low}")).ShouldBeSet(["crit-future", "crit-asap-old", "crit-overdue", "crit-asap-new", "low-future-timed"]);

        (await d.QueueAsync($"type={d.W.TaskTypeId}")).GetProperty("total").GetInt32().ShouldBe(d.Titles.Count);
        (await d.QueueAsync("type=9999")).GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task Pod_assignee_unassigned_and_creator_filters_work_and_include_inactive_users()
    {
        var d = await DataAsync();
        TitlesOf(await d.QueueAsync($"pod={d.PodB}")).ShouldBeSet(["mine-pod-b", "podb-queue"]);
        TitlesOf(await d.QueueAsync($"pod={d.PodB}&pod={d.PodC}")).ShouldBeSet(["mine-pod-b", "podb-queue", "podc-queue"]);

        // TechC was deactivated after the Task was assigned: the assignee filter still finds the Task, and the row shows the inactive flag.
        var former = await d.QueueAsync($"assignee={d.TechC}");
        TitlesOf(former).ShouldBe(Of("former-employee"));
        Row(former, "former-employee").GetProperty("assignedUser").GetProperty("isActive").GetBoolean().ShouldBeFalse();

        TitlesOf(await d.QueueAsync($"assignee={d.TechB}")).ShouldBeSet(["poda-member", "created-by-tech-b"]);

        var unassigned = await d.QueueAsync("unassigned=true");
        unassigned.GetProperty("items").EnumerateArray().ShouldAllBe(r => r.GetProperty("assignedUser").ValueKind == JsonValueKind.Null);
        var unassignedTitles = TitlesOf(unassigned);
        unassignedTitles.ShouldContain("poda-queue-1"); // Pod set, no person
        unassignedTitles.ShouldContain("crit-asap-old");
        unassignedTitles.ShouldNotContain("poda-member");

        var either = TitlesOf(await d.QueueAsync($"unassigned=true&assignee={d.TechC}"));
        either.ShouldContain("former-employee");
        either.ShouldContain("crit-asap-old");
        either.ShouldNotContain("mine-soon");

        TitlesOf(await d.QueueAsync($"creator={d.TechA}")).ShouldBeSet(["created-by-tech", "created-by-tech-b"]);
        (await d.QueueAsync($"creator={d.TechA}&assignee={d.TechB}")).GetProperty("items").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task Client_matter_project_and_workflow_filters_work()
    {
        var d = await DataAsync();
        TitlesOf(await d.QueueAsync($"client={d.Client2Id}")).ShouldBe(Of("other-matter"));
        TitlesOf(await d.QueueAsync($"matter={d.Matter2Id}")).ShouldBe(Of("other-matter"));
        (await d.QueueAsync($"client={d.Client1Id}")).GetProperty("total").GetInt32().ShouldBe(d.Titles.Count - 1);
        TitlesOf(await d.QueueAsync($"project={d.W.ProjectId}")).ShouldBe(Of("with-project"));
        TitlesOf(await d.QueueAsync($"client={d.Client2Id}&matter={d.W.MatterId}")).ShouldBeEmpty();

        TitlesOf(await d.QueueAsync($"workflow={d.W.UnorderedWorkflowId}")).ShouldBeSet(["other-matter", "requested-by-zed", "mine-done", "poda-done"]);
        (await d.QueueAsync($"workflow={d.W.OrderedWorkflowId}")).GetProperty("total").GetInt32().ShouldBe(
            (await d.QueueAsync()).GetProperty("total").GetInt32() - 4);
    }

    [Fact]
    public async Task Date_range_and_requestor_filters_work()
    {
        var d = await DataAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var total = (await d.QueueAsync()).GetProperty("total").GetInt32();

        (await d.QueueAsync($"createdFrom={today.AddDays(-1):yyyy-MM-dd}")).GetProperty("total").GetInt32().ShouldBe(total);
        (await d.QueueAsync($"createdFrom={today.AddDays(2):yyyy-MM-dd}")).GetProperty("total").GetInt32().ShouldBe(0);
        (await d.QueueAsync($"createdTo={today.AddDays(2):yyyy-MM-dd}")).GetProperty("total").GetInt32().ShouldBe(total);
        (await d.QueueAsync($"createdTo={today.AddDays(-2):yyyy-MM-dd}")).GetProperty("total").GetInt32().ShouldBe(0);

        // Due range applies to explicit dates only; ASAP never matches.
        TitlesOf(await d.QueueAsync("dueFrom=2000-01-01&dueTo=2000-01-02")).ShouldBeSet(["crit-overdue", "norm-timed-past"]);
        TitlesOf(await d.QueueAsync("dueFrom=2099-01-01")).ShouldBeSet(["crit-future", "mine-far", "low-future-timed"]);
        TitlesOf(await d.QueueAsync("dueTo=2000-12-31")).ShouldBeSet(["crit-overdue", "norm-timed-past", "mine-overdue", "mine-done", "poda-queue-2"]);

        TitlesOf(await d.QueueAsync("requestor=zed")).ShouldBe(Of("requested-by-zed"));
        TitlesOf(await d.QueueAsync("requestor=client.example")).ShouldBe(Of("requested-by-zed"));

        // Completed / cancelled date range only matches closed tasks.
        var closed = TitlesOf(await d.QueueAsync($"completedFrom={today.AddDays(-1):yyyy-MM-dd}")).ToList();
        closed.ShouldBeSet(["mine-done", "mine-cancelled", "poda-done"]);
        (await d.QueueAsync($"completedTo={today.AddDays(-2):yyyy-MM-dd}")).GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task Filters_combine()
    {
        var d = await DataAsync();
        var page = await d.QueueAsync($"status=NEW&status=IN_PROGRESS&priority={d.Critical}&overdue=true&pod={d.PodA}");
        page.GetProperty("total").GetInt32().ShouldBe(0);

        var combined = await d.QueueAsync($"status=NEW&priority={d.Critical}&overdue=true");
        TitlesOf(combined).ShouldBe(Of("crit-overdue"));

        TitlesOf(await d.QueueAsync($"pod={d.PodA}&overdue=true&status=NEW")).ShouldBe(Of("poda-queue-2"));
        TitlesOf(await d.QueueAsync($"pod={d.PodA}&unassigned=true&asap=true&q=queue")).ShouldBe(Of("poda-queue-1"));
    }

    [Fact]
    public async Task The_queue_needs_Task_View_and_shows_all_tasks_to_every_viewer()
    {
        var d = await DataAsync();
        var noAccess = await d.H.UserWithAsync(@"KE\nobody", "Matter.View");
        await ProblemAsync(await noAccess.GetAsync("/api/v1/task-queue"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await noAccess.GetAsync("/api/v1/my-work"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await noAccess.GetAsync("/api/v1/pod-work"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");

        var viewer = await d.H.UserWithAsync(@"KE\viewer", "Task.View");
        (await d.QueueAsync(client: viewer)).GetProperty("total").GetInt32().ShouldBe((await d.QueueAsync()).GetProperty("total").GetInt32());
    }
}
